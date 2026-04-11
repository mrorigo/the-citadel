import {
    generateText,
    jsonSchema,
    type LanguageModel,
    type ModelMessage,
    type TextPart,
    type Tool,
    type ToolCallPart,
    type ToolResultPart,
    tool,
} from "ai";
import { minimatch } from "minimatch";
import { z } from "zod";
import { getConfig } from "../config";
import type { AgentRole } from "../config/schema";
import { getMCPService } from "../services/mcp";
import { getProjectContext } from "../services/project-context";
import { getIgnoredPatterns } from "./gitignore";
import { getInstructionService } from "./instruction";
import { getAgentModel } from "./llm";
import { logger } from "./logger";
import { getPearls, type PearlsClient } from "./pearls";
import { getToolResultMemory } from "./memory";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function smartTruncate(obj: any, limit: number = 500): any {
    if (typeof obj === "string") {
        return obj.length > limit ? `${obj.substring(0, limit)}... (truncated)` : obj;
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => smartTruncate(item, limit));
    }
    if (obj !== null && typeof obj === "object") {
        const result: any = {};
        for (const key in obj) {
            result[key] = smartTruncate(obj[key], limit);
        }
        return result;
    }
    return obj;
}

export interface AgentContext {
    pearlId?: string;
    [key: string]: unknown;
}

export class AgentStepLimitReachedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgentStepLimitReachedError";
    }
}

export interface ToolContext extends AgentContext {
    toolCallId: string;
    messages: ModelMessage[];
    pearlsClient?: PearlsClient;
}

export abstract class CoreAgent {
    protected role: AgentRole;
    protected model: LanguageModel;
    protected tools: Record<string, Tool> = {};
    protected dynamicTools: Record<string, Tool> = {};
    protected schemas: Record<string, z.ZodTypeAny> = {};
    protected requiresExplicitCompletion = false;
    protected pearlsClient?: PearlsClient;

    constructor(role: AgentRole, model?: LanguageModel, pearlsClient?: PearlsClient) {
        this.role = role;
        this.model = model || getAgentModel(role);
        this.pearlsClient = pearlsClient;
    }

    /**
     * Override this to provide tools dynamically based on context.
     * These will be merged with registered static tools (like MCP tools).
     */
    protected async getDynamicTools(
        _context?: AgentContext,
    ): Promise<Record<string, Tool>> {
        return {};
    }

    private mcpLoaded = false;
    protected async executeGenerateText(
        messages: ModelMessage[],
    ): Promise<Awaited<ReturnType<typeof generateText>>> {
        // SANITIZATION: We must remove the 'execute' property before passing tools to the AI SDK.
        // If 'execute' is present, the SDK will auto-call the tool immediately on the provider's response.
        // We handle tool execution manually in our loop to manage logging, approval, and state.
        const sanitizedTools: Record<string, Tool> = {};
        const allTools = { ...this.tools, ...this.dynamicTools };

        for (const [name, tool] of Object.entries(allTools)) {
            const { execute, ...rest } = tool as any;
            sanitizedTools[name] = rest as Tool;
        }

        return generateText({
            model: this.model,
            tools: sanitizedTools,
            messages: messages,
        });
    }

    protected async registerBuiltinTools() {
        if (this.mcpLoaded) return;

        const config = getConfig();
        const roleConfig = config.agents[this.role];
        const assignedTools = roleConfig?.mcpTools;

        if (assignedTools && assignedTools.length > 0) {
            const mcp = getMCPService();
            const tools = await mcp.getToolsForAgent(assignedTools);

            for (const tool of tools) {
                const toolName = `${tool.serverName}_${tool.name}`;
                logger.debug(`[${this.role}] Registering MCP tool: ${toolName}`);

                this.registerTool(
                    toolName,
                    tool.description || `MCP Tool from ${tool.serverName}`,
                    // biome-ignore lint/suspicious/noExplicitAny: AI SDK tool registration bridge
                    jsonSchema(tool.inputSchema) as any,
                    // biome-ignore lint/suspicious/noExplicitAny: arguments are generic for MCP
                    async (args: any, toolContext: any) => {
                        const result = await mcp.callTool(tool.serverName, tool.name, args);
                        return result;
                    },
                );
            }
        }
        this.mcpLoaded = true;
    }

    protected registerTool<T extends z.ZodTypeAny, R>(
        name: string,
        description: string,
        schema: T,
        execute: (args: z.infer<T>, toolContext?: ToolContext) => Promise<R>,
    ) {
        const options = {
            description,
            inputSchema: schema,
            execute,
        };
        // We use unknown cast as a way to bridge the gap between our generic T and the SDK internal expectations
        this.tools[name] = tool(
            options as unknown as Parameters<typeof tool>[0],
        ) as Tool;
        this.schemas[name] = schema;
    }

    /**
     * Registers an AI SDK Tool directly, ensuring its schema is discoverable.
     */
    protected registerSdkTool(name: string, sdkTool: Tool) {
        this.tools[name] = sdkTool;
        // In AI SDK v6, the schema is stored in inputSchema
        // biome-ignore lint/suspicious/noExplicitAny: SDK property access
        this.schemas[name] = (sdkTool as any).inputSchema;
    }

    /**
     * Override this to provide the system prompt.
     */
    protected getSystemPrompt(defaultPrompt: string): string {
        return defaultPrompt;
    }

    /**
     * Check permissions based on AGENTS.md frontmatter.
     * NOTE: It could be useful to return the actual path that was blocked, this
     *       would give agent more context to fix the issue.
     */
    protected async checkPermissions(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<{ allowed: boolean; error?: string }> {
        // 1. Identify target paths
        const targets: string[] = [];
        if (!args || typeof args !== 'object') return { allowed: true };

        if ('paths' in args && Array.isArray(args.paths)) {
            targets.push(...(args.paths as string[]));
        }
        if (args.path && typeof args.path === "string") targets.push(args.path);
        if (args.source && typeof args.source === "string")
            targets.push(args.source);
        if (args.destination && typeof args.destination === "string")
            targets.push(args.destination);

        if (targets.length === 0 && !toolName.includes("run_command"))
            return { allowed: true };

        // For simplicity in this reference implementation, we assume CWD is process.cwd()
        // currently the cwd for agents is fixed to the project root
        const cwd = process.cwd();
        const projectContext = await getProjectContext().resolveContext(cwd, cwd);

        // Backward compatibility: Fallback to sensible defaults if frontmatter is missing
        const fm = projectContext?.config.frontmatter || {
            ignore: [".git/**", "node_modules/**", ".env", ".DS_Store"],
            forbidden: [".git/**", "node_modules/**"],
            read_only: []
        };

        const { ignore, read_only, forbidden } = fm;

        // Helper to check globs
        const matches = (path: string, patterns: string[]) => {
            for (const pattern of patterns) {
                if (minimatch(path, pattern, { dot: true })) return true; // Standard glob match
                if (path.includes(pattern)) return true; // Simple substring match for safety
            }
            return false;
        };

        // Check Targets
        for (const target of targets) {
            // Forbidden
            if (forbidden && matches(target, forbidden)) {
                return {
                    allowed: false,
                    error: `Access to '${target}' is FORBIDDEN by AGENTS.md`,
                };
            }

            // Read Only (Write Protection)
            if (read_only && matches(target, read_only)) {
                const isWrite =
                    toolName.includes("write") ||
                    toolName.includes("edit") ||
                    toolName.includes("delete");
                if (isWrite) {
                    return {
                        allowed: false,
                        error: `Modification of '${target}' is READ-ONLY by AGENTS.md`,
                    };
                }
            }

            // Ignore (Visibility Protection)
            if (ignore && matches(target, ignore)) {
                const isRead =
                    toolName.includes("read") ||
                    toolName.includes("list") ||
                    toolName.includes("search");
                if (isRead) {
                    // We could return allowed: false, OR we could silently filter.
                    // The spec says "Treated as non-existent".
                    // For a direct read, that means "Not Found" error is appropriate (or just blocked).
                    return {
                        allowed: false,
                        error: `File '${target}' is IGNORED (hidden) by AGENTS.md`,
                    };
                }
            }
        }

        // Check Command Strings (Heuristic)
        if (toolName.includes("run_command") && args.command) {
            const cmd = args.command as string;
            if (forbidden) {
                for (const pat of forbidden) {
                    if (cmd.includes(pat))
                        return {
                            allowed: false,
                            error: `Command contains forbidden pattern '${pat}'`,
                        };
                }
            }
            if (read_only) {
                // For read-only, we must assume commands are writes unless we know otherwise?
                // Or just block if they touch read-only files?
                // Let's be conservative: if a command explicitly references a read-only file, block it to be safe.
                for (const pat of read_only) {
                    if (cmd.includes(pat))
                        return {
                            allowed: false,
                            error: `Command references read-only file '${pat}'`,
                        };
                }
            }
        }

        return { allowed: true };
    }

    /**
     * The Unified Loop:
     * - Loads Project Context (AGENTS.md)
     * - Runs a manual loop interacting with the LLM
     * - Handles tool execution manually for better control/logging
     */
    async run(prompt: string, context?: AgentContext): Promise<string> {
        logger.info(`[${this.role}] Running...`, { role: this.role, prompt: prompt.length > 400 ? `${prompt.slice(0, 400)}...` : prompt });

        // Ensure MCP tools are loaded
        await this.registerBuiltinTools();

        // 0. Load Dynamic Tools
        this.dynamicTools = await this.getDynamicTools(context);

        // 1. Resolve Context and Build Prompt using InstructionService
        const instructionService = getInstructionService();
        const baseSystem = await instructionService.buildPrompt(
            {
                role: this.role,
                pearlId: context?.pearlId,
                labels: context?.labels as string[] | undefined,
                context: context,
            },
            `You are a ${this.role}. Execute the request.
        
        # Tools
        You have access to tools. You MUST use them to perform actions.
        `,
        );

        const system = this.getSystemPrompt(baseSystem);

        const messages: ModelMessage[] = [
            { role: "system", content: system },
            {
                role: "user",
                content: `Context: ${JSON.stringify(context || {})}\n\nRequest: ${prompt}`,
            },
        ];

        let finalResult = "";



        let completionRetryCount = 0;
        const maxCompletionRetries = 1;
        let completionToolCalled = false;

        const totalUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        };

        // Audit Log Collection
        const auditLogs: string[] = [];
        let finished = false;

        // Max steps 50 to prevent infinite loops but allow complex tasks
        for (let i = 0; i < 50; i++) {
            // Prune History
            const config = getConfig();
            const { maxHistoryMessages = 20, maxToolResponseSize = 50000, maxMessageSize = 100000 } = config.context || {};

            if (messages.length > maxHistoryMessages) {
                const systemMessage = messages[0];
                const userRequest = messages[1];

                // Keep system + request + last N to reach maxHistoryMessages
                const lastNCount = Math.max(0, maxHistoryMessages - 2);
                const lastN = messages.slice(-lastNCount);

                // Safety Check: Avoid splitting Tool Call / Tool Result pairs
                // If the first message in our slice is a 'tool' result, we likely dropped the 'assistant' call.
                // We should grab the preceding message too.
                if (lastN.length > 0 && lastN[0] && lastN[0].role === "tool") {
                    const toolResult = lastN[0];
                    const originalIndex = messages.indexOf(toolResult);
                    if (originalIndex > 0) {
                        const preceding = messages[originalIndex - 1];
                        if (preceding && preceding !== userRequest && preceding !== systemMessage) {
                            lastN.unshift(preceding);
                        }
                    }
                }

                // Reconstruct: Keep System + Request + Recent Context
                messages.length = 0;
                if (systemMessage) messages.push(systemMessage);
                if (userRequest && userRequest !== systemMessage)
                    messages.push(userRequest);
                messages.push(...lastN);
            }

            let result;
            try {
                result = await this.executeGenerateText(messages);
            } catch (error: any) {
                // LLM Traceability Enhancement
                const traceId = `trace_${Date.now()}_${context?.pearlId || "unknown"}`;
                const traceDir = join(process.cwd(), ".citadel", "traces");
                const tracePath = join(traceDir, `${traceId}.json`);

                const errorMetadata = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    statusCode: error.statusCode,
                    responseBody: error.responseBody,
                    data: error.data,
                    cause: error.cause
                };

                // Try to extract a more useful message from responseBody if it exists
                let detailedMessage = error.message;
                if (error.responseBody) {
                    try {
                        const body = JSON.parse(error.responseBody);
                        const bodyError = body.error || body;
                        const msg = bodyError.message || bodyError.error?.message;
                        if (msg && msg !== "Provider returned error") {
                            detailedMessage = `${error.message} (${msg})`;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                const traceContent = {
                    timestamp: new Date().toISOString(),
                    role: this.role,
                    pearlId: context?.pearlId,
                    error: errorMetadata,
                    messages: messages.map(m => ({
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content : '[Object Content]'
                    })),
                    tools: Object.keys(this.tools).map(t => {
                        const toolObj = this.tools[t] as any;
                        return {
                            name: t,
                            description: toolObj.description,
                            inputSchema: toolObj.inputSchema,
                            parameters: toolObj.parameters
                        };
                    })
                };

                try {
                    mkdirSync(traceDir, { recursive: true });
                    writeFileSync(tracePath, JSON.stringify(traceContent, null, 2));
                    logger.error(`[${this.role}] LLM execution failed (Status: ${error.statusCode || 'N/A'}). Detailed trace written to: ${tracePath}`, error);
                } catch (logErr) {
                    logger.error(`[${this.role}] Failed to write trace file`, logErr);
                }

                throw new Error(`LLM Error (${error.name}: ${detailedMessage}${error.statusCode ? ` | Status: ${error.statusCode}` : ''}). Trace: ${tracePath}`);
            }

            // Accumulate Usage
            if (result.usage) {
                totalUsage.inputTokens += result.usage.inputTokens || 0;
                totalUsage.outputTokens += result.usage.outputTokens || 0;
                totalUsage.totalTokens += result.usage.totalTokens || 0;
            }

            // Construct Assistant Message from result
            // We must manually add the assistant's response to history so the subsequent tool-result message is valid.
            const assistantContent: (TextPart | ToolCallPart)[] = [];
            if (result.text) {
                assistantContent.push({ type: "text", text: result.text });
            }
            if (result.toolCalls && result.toolCalls.length > 0) {
                assistantContent.push(
                    ...result.toolCalls.map((tc) => ({
                        type: "tool-call" as const,
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        input: tc.input,
                    })),
                );
            }

            // Only push if there is content
            if (assistantContent.length > 0) {
                // Size Check (Basic estimation)
                const contentStr = JSON.stringify(assistantContent);
                if (contentStr.length > maxMessageSize) {
                    logger.warn(`[${this.role}] Message size ${contentStr.length} exceeds limit ${maxMessageSize}. Truncating logic not fully implemented for mixed content, but proceeding.`);
                    // TODO: Implement smart truncation for assistant messages if needed
                }
                messages.push({ role: "assistant", content: assistantContent });
            }

            finalResult = result.text;

            // Log output
            if (result.text) {
                logger.info(`[${this.role}] Output`, { text: result.text });
            }

            const toolCalls = result.toolCalls;

            // If no tools, we might be done
            if (!toolCalls || toolCalls.length === 0) {
                // AGENT ENCOURAGEMENT: If the agent provides text but no tool calls,
                // and we require explicit completion, remind them up to maxCompletionRetries times.
                if (
                    this.requiresExplicitCompletion &&
                    !completionToolCalled
                ) {
                    completionRetryCount++;
                    if (completionRetryCount <= maxCompletionRetries) {
                        logger.info(
                            `[${this.role}] Agent exited without completion tool. Providing reminder ${completionRetryCount}/${maxCompletionRetries}.`,
                        );

                        let hint = `# MANDATORY COMPLETION PROTOCOL
You provided a response but did not call a completion tool. 
To finalize your work, you MUST call exactly one of: \`submit_work\`, \`approve_work\`, \`reject_work\`, or \`fail_work\`.

**Text-only responses are NOT accepted as task completion.** 
If you are finished, submit your work now. If you are still working, continue with your next tool call.`;

                        // On subsequent retries, inject tool documentation to help a "lost" agent
                        if (completionRetryCount > 1) {
                            const completionTools = Object.keys(this.tools).filter(t =>
                                t.includes("submit_work") || t.includes("approve_work") || t.includes("reject_work")
                            );
                            const primaryTool = completionTools[0];
                            if (primaryTool) {
                                hint += `\n\n### Tool Schema Reference: ${primaryTool}
\`\`\`json
${JSON.stringify(this.schemas[primaryTool], null, 2)}
\`\`\``;
                            }
                        }

                        messages.push({
                            role: "user",
                            content: hint,
                        });
                        continue;
                    }
                }
                break;
            }

            // RESET Completion Retry Count: If the agent actually called tools, they are working.
            if (toolCalls && toolCalls.length > 0) {
                completionRetryCount = 0;
            }

            // Execute tools
            const toolResults: ToolResultPart[] = [];
            // Reset finished state for this turn (or maybe not? Logic check: finished breaks loop anyway.
            // But we promoted 'finished' to outer scope. If we set it true here, we break.
            // Wait, we need to ensure we don't re-declare it.

            for (const tc of toolCalls) {
                logger.info(`[${this.role}] Executing tool: ${tc.toolName}`, {
                    tool: tc.toolName,
                    full_tc: tc,
                });

                let toolName = tc.toolName;
                let toolItem = this.tools[toolName];

                if (!toolItem && toolName.length >= 5) {
                    const matches = Object.keys(this.tools).filter(
                        (k) => k.endsWith(`_${toolName}`) || k.endsWith(`-${toolName}`),
                    );
                    if (matches.length === 1 && matches[0]) {
                        const resolvedName = matches[0];
                        logger.info(
                            `[${this.role}] Auto-resolved tool ${toolName} to ${resolvedName}`,
                        );
                        toolName = resolvedName;
                        toolItem = this.tools[toolName] || this.dynamicTools[toolName];
                    } else {
                        toolItem = this.dynamicTools[toolName] || this.tools[toolName];
                    }
                }

                if (!toolItem) {
                    const hint = toolName.includes("read_file")
                        ? "Did you mean `filesystem_read_text_file`?"
                        : toolName.includes("write_file")
                            ? "Did you mean `filesystem_write_text_file`?"
                            : "";
                    toolResults.push({
                        type: "tool-result",
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: {
                            type: "error-text",
                            value: `Tool ${tc.toolName} not found. ${hint}`,
                        },
                    } as ToolResultPart);
                    continue;
                }

                if (!toolItem.execute) {
                    toolResults.push({
                        type: "tool-result",
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: {
                            type: "error-text",
                            value: `Tool ${tc.toolName} has no execute method`,
                        },
                    } as ToolResultPart);
                    continue;
                }

                try {
                    // Internal execution
                    // Strictly validate input against schema if it's a Zod schema
                    const schema = this.schemas[toolName];

                    const validatedInput =
                        schema && "parse" in schema && typeof schema.parse === "function"
                            ? schema.parse(tc.input)
                            : tc.input;
                    const toolContext = {
                        toolCallId: tc.toolCallId,
                        messages,
                        ...(context || {}),
                    };
                    // --- ENFORCEMENT POINT (Input) ---
                    const perm = await this.checkPermissions(
                        toolName,
                        validatedInput as Record<string, unknown>,
                    );
                    if (!perm.allowed) {
                        logger.warn(
                            `[${this.role}] Permission denied for ${toolName}: ${perm.error}`,
                        );
                        toolResults.push({
                            type: "tool-result",
                            toolCallId: tc.toolCallId,
                            toolName: tc.toolName,
                            output: {
                                type: "error-text",
                                value: `Permission Denied: ${perm.error}`,
                            },
                        } as ToolResultPart);
                        continue;
                    }

                    // Inject Excludes for Search/Tree
                    if (
                        toolName.includes("search_files") ||
                        toolName.includes("directory_tree") ||
                        toolName.includes("list_directory")
                    ) {
                        const projectContext = await getProjectContext().resolveContext(
                            process.cwd(),
                            process.cwd(),
                        );

                        const ignored = getIgnoredPatterns();
                        // Backward compatibility: If frontmatter is missing, use basic system patterns
                        const frontmatterExcludes = projectContext?.config.frontmatter
                            ? [...(projectContext.config.frontmatter.forbidden || []), ...(projectContext.config.frontmatter.ignore || [])]
                            : [".git/**", "node_modules/**", ".env", ".DS_Store"];

                        const excludes = Array.from(new Set([...ignored, ...frontmatterExcludes]));

                        if (excludes.length > 0) {
                            // biome-ignore lint/suspicious/noExplicitAny: Input is dynamic
                            const input = validatedInput as any;
                            input.excludePatterns = excludes;
                        }
                    }
                    // -------------------------

                    // biome-ignore lint/suspicious/noExplicitAny: Context and tool mapping is dynamic
                    const output = await (toolItem as any).execute(validatedInput, {
                        ...toolContext,
                        pearlsClient: this.pearlsClient,
                    } as any);

                    // --- ENFORCEMENT POINT (Output) ---
                    if (
                        toolName.includes("list_directory") &&
                        // biome-ignore lint/suspicious/noExplicitAny: Output is dynamic
                        (output as any).content &&
                        // biome-ignore lint/suspicious/noExplicitAny: Output content should be array
                        Array.isArray((output as any).content)
                    ) {
                        const projectContext = await getProjectContext().resolveContext(
                            process.cwd(),
                            process.cwd(),
                        );
                        if (projectContext?.config.frontmatter?.forbidden) {
                            const forbidden = projectContext.config.frontmatter.forbidden;
                            // biome-ignore lint/suspicious/noExplicitAny: Part is dynamic
                            (output as any).content = (output as any).content.map((part: any) => {
                                if (part.type === "text" && part.text) {
                                    const lines = part.text.split("\n");
                                    const filteredLines = lines.filter((line: string) => {
                                        // Line format is typically "[DIR] name" or "[FILE] name"
                                        // Or just standard ls output.
                                        // We check if the line contains any forbidden pattern
                                        for (const pattern of forbidden) {
                                            // Strip prefixes like "[FILE] " or "[DIR] " before matching
                                            const cleanLine = line.replace(/^\[(FILE|DIR)\]\s+/, "").trim();
                                            if (
                                                minimatch(cleanLine, pattern, { dot: true, matchBase: true })
                                            )
                                                return false;
                                        }
                                        return true;
                                    });
                                    return { type: "text", text: filteredLines.join("\n") };
                                }
                                return part;
                            });
                        }
                    }
                    // -------------------------

                    // Check for explicit finish signals if tool returns them?
                    // Not standard, but we can convention.
                    // Or check specific tool names.
                    const completionTools = [
                        "submit_work",
                        "approve_work",
                        "reject_work",
                        "fail_work",
                        "enqueue_task",
                    ];
                    if (completionTools.includes(toolName)) {
                        finished = true;
                        completionToolCalled = true;
                    }

                    // --- AUDIT LOGGING ---
                    // Check for 'audit' field in output
                    if (output && typeof output === 'object' && (output as Record<string, unknown>).audit) {
                        const auditMsg = (output as Record<string, unknown>).audit;
                        if (typeof auditMsg === 'string') {
                            auditLogs.push(auditMsg);
                        }
                    }
                    // ---------------------

                    // --- TRUNCATION & OFFLOADING LOGIC ---
                    let toolOutputValue = typeof output === "string" ? output : JSON.stringify(output);

                    // We check if we should offload to memory instead of truncating
                    const offloadThreshold = config.context?.offloadThresholds?.[toolName] || maxToolResponseSize;

                    if (toolOutputValue.length > offloadThreshold) {
                        logger.info(`[${this.role}] Tool ${toolName} output (${toolOutputValue.length} chars) exceeds threshold (${offloadThreshold}). Offloading to memory.`);
                        const memoryId = await getToolResultMemory().store(context?.pearlId || "default", toolOutputValue);
                        toolOutputValue = `--- TOOL RESULT OFFLOADED ---\nThe result from '${toolName}' was too large and has been offloaded to Citadel Memory.\nResult ID: ${memoryId}\n\nYou MUST use the 'inspect_result' tool with this ID to query or analyze the content.`;
                    } else if (toolOutputValue.length > maxToolResponseSize) {
                        const truncated = toolOutputValue.substring(0, maxToolResponseSize);
                        toolOutputValue = `${truncated}\n... [Output truncated. Total size: ${toolOutputValue.length} characters (Limit: ${maxToolResponseSize})]`;
                        logger.warn(`[${this.role}] Tool ${toolName} output truncated from ${toolOutputValue.length} to ${maxToolResponseSize}`);
                    }
                    // ------------------------
                    logger.info(`[${this.role}] Tool ${toolName} finished`, {
                        tool: toolName,
                        input: tc.input,
                        output: smartTruncate(output, 500),
                        size: toolOutputValue.length
                    });

                    const toolOutput = { type: "text" as const, value: toolOutputValue };

                    toolResults.push({
                        type: "tool-result",
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: toolOutput,
                    } as ToolResultPart);
                } catch (error: unknown) {
                    let errorMessage =
                        error instanceof Error ? error.message : String(error);

                    // Enhanced Zod Error Handling
                    if (error instanceof z.ZodError) {
                        const _schemaDescription = (
                            toolItem as { inputSchema?: { description?: string } }
                        ).inputSchema
                            ? JSON.stringify(
                                (toolItem as { inputSchema?: { description?: string } })
                                    .inputSchema?.description || "See tool definition",
                            ) // Basic schema hint
                            : "No schema available";

                        const formattedIssues = error.issues
                            .map((i) => `${i.path.join(".")}: ${i.message}`)
                            .join("; ");
                        errorMessage = `Validation Error: Invalid arguments. Issues: [${formattedIssues}]. Please correct your input and retry.`;
                    }

                    logger.error(`[${this.role}] Tool execution failed: ${tc.toolName}`, {
                        error: errorMessage,
                    });
                    toolResults.push({
                        type: "tool-result",
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: "error-text", value: errorMessage },
                    } as ToolResultPart);
                }
            }

            messages.push({ role: "tool", content: toolResults });

            if (finished) {
                logger.info(`[${this.role}] Task finished explicitly via tool.`);
                break;
            }

            if (i === 49) {
                logger.warn(`[${this.role}] Agent reached maximum step limit (50 steps) for ${context?.pearlId || "unknown"}`);
                throw new AgentStepLimitReachedError(`Agent reached maximum step limit (50 steps) without explicit completion.`);
            }
        }



        // Report Token Usage if linked to a pearl
        // Combine Audit Logs + Token Usage and Post Comment
        if (context?.pearlId) {
            const auditContent: string[] = [];

            if (auditLogs.length > 0) {
                auditContent.push(auditLogs.join("\n\n"));
            }

            if (auditContent.length > 0 || totalUsage.totalTokens > 0) {
                const parts: string[] = [];
                if (auditContent.length > 0) {
                    parts.push(auditContent.join("\n\n"));
                }

                // Append usage stats (collapsed)
                if (totalUsage.totalTokens > 0) {
                    parts.push(
                        `
<details>
<summary>Agent Usage Stats (${this.role})</summary>

- **Input Tokens**: ${totalUsage.inputTokens}
- **Output Tokens**: ${totalUsage.outputTokens}
- **Total Tokens**: ${totalUsage.totalTokens}
</details>`.trim()
                    );
                }

                const finalComment = parts.join("\n\n---\n\n");

                try {
                    const client = this.pearlsClient || getPearls();
                    // Run in background to not block agent loop
                    client.addComment(context.pearlId, finalComment).catch(err => {
                        logger.warn(`[${this.role}] Failed to post audit comment to pearl ${context.pearlId}`, { error: err });
                    });
                } catch (err) {
                    logger.warn(`[${this.role}] Error preparing audit comment`, { error: err });
                }
            }
        }

        return finalResult;
    }
}
