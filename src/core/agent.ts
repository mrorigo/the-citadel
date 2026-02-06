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
import { getBeads, type BeadsClient } from "./beads";

export interface AgentContext {
    beadId?: string;
    [key: string]: unknown;
}

export interface ToolContext extends AgentContext {
    toolCallId: string;
    messages: ModelMessage[];
}

export abstract class CoreAgent {
    protected role: AgentRole;
    protected model: LanguageModel;
    protected tools: Record<string, Tool> = {};
    protected dynamicTools: Record<string, Tool> = {};
    protected schemas: Record<string, z.ZodTypeAny> = {};
    protected requiresExplicitCompletion = false;
    protected beadsClient?: BeadsClient;

    constructor(role: AgentRole, model?: LanguageModel, beadsClient?: BeadsClient) {
        this.role = role;
        this.model = model || getAgentModel(role);
        this.beadsClient = beadsClient;
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
        return generateText({
            model: this.model,
            tools: { ...this.tools, ...this.dynamicTools }, // Merge static and dynamic
            messages: messages,
        });
    }

    private async registerBuiltinTools() {
        if (this.mcpLoaded) return;

        const config = getConfig();
        const roleConfig = config.agents[this.role];
        const assignedTools = roleConfig.mcpTools;

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
                    async (args: any) => {
                        // Middleware: Inject .gitignore patterns for filesystem search
                        if (
                            ["search_files", "directory_tree"].includes(tool.name) &&
                            tool.serverName === "filesystem"
                        ) {
                            const ignored = getIgnoredPatterns();
                            const current = (args.excludePatterns as string[]) || [];
                            const merged = Array.from(
                                new Set([
                                    ...current,
                                    ...ignored,
                                    ".beads",
                                    ".citadel",
                                    ".codeflow",
                                ]),
                            );
                            args.excludePatterns = merged;

                            logger.info(
                                `[${this.role}] Injected ${merged.length} ignore patterns into search_files`,
                            );
                        }

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
        execute: (args: z.infer<T>) => Promise<R>,
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

        if (!projectContext?.config.frontmatter) return { allowed: true };

        const { ignore, read_only, forbidden } = projectContext.config.frontmatter;

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
        logger.info(`[${this.role}] Running...`, { role: this.role });

        // Ensure MCP tools are loaded
        await this.registerBuiltinTools();

        // 0. Load Dynamic Tools
        this.dynamicTools = await this.getDynamicTools(context);

        // 1. Resolve Context and Build Prompt using InstructionService
        const instructionService = getInstructionService();
        const baseSystem = await instructionService.buildPrompt(
            {
                role: this.role,
                beadId: context?.beadId,
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



        let didRemindForCompletion = false;
        let completionToolCalled = false;

        const totalUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        };

        // Max steps 50 to prevent infinite loops but allow complex tasks
        for (let i = 0; i < 50; i++) {
            // Prune History
            const config = getConfig();
            const { maxHistoryMessages = 20, maxToolResponseSize = 50000, maxMessageSize = 100000 } = config.context || {};

            if (messages.length > maxHistoryMessages) {
                const systemMessage = messages[0];
                const lastN = messages.slice(-maxHistoryMessages);

                // Safety Check: Avoid splitting Tool Call / Tool Result pairs
                // If the first message in our slice is a 'tool' result, we likely dropped the 'assistant' call.
                // We should grab the preceding message too.
                if (lastN.length > 0 && lastN[0] && lastN[0].role === 'tool') {
                    // Find the index of this tool result in the original array
                    const toolResult = lastN[0];
                    const originalIndex = messages.indexOf(toolResult);
                    if (originalIndex > 0) {
                        // Grab the message before it (the assistant tool call)
                        const preceding = messages[originalIndex - 1];
                        // If it's not already in lastN, unshift it
                        if (preceding && preceding !== toolResult) {
                            lastN.unshift(preceding);
                        }
                    }
                }

                // Reconstruct: Keep System + Recent Context
                // We use splice to modify in place or just reassign? `messages` is a local const array reference but mutable content.
                // We reassign the array content.
                messages.length = 0;
                messages.push(...lastN);
                if (systemMessage) {
                    messages.unshift(systemMessage);
                }
            }

            const result = await this.executeGenerateText(messages);

            console.log('DEBUG: result.usage', JSON.stringify(result.usage));

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
                // and we require explicit completion, remind them ONCE.
                if (
                    this.requiresExplicitCompletion &&
                    !completionToolCalled &&
                    !didRemindForCompletion
                ) {
                    logger.info(
                        `[${this.role}] Agent exited without completion tool. Providing reminder.`,
                    );
                    messages.push({
                        role: "user",
                        content: `You provided a response but did not call a completion tool (e.g., submit_work, approve_work, reject_work, fail_work). 
If you have finished your task, you MUST call the appropriate tool to finalize the workflow. 
If you are still working, continue with your next step.`,
                    });
                    didRemindForCompletion = true;
                    continue;
                }
                break;
            }

            // Execute tools
            const toolResults: ToolResultPart[] = [];
            let finished = false;

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
                        toolName.includes("directory_tree")
                    ) {
                        const projectContext = await getProjectContext().resolveContext(
                            process.cwd(),
                            process.cwd(),
                        );
                        if (projectContext?.config.frontmatter) {
                            const { forbidden, ignore } = projectContext.config.frontmatter;
                            const excludes = [...(forbidden || []), ...(ignore || [])];
                            if (excludes.length > 0) {
                                // Assume tool supports 'exclude' or 'excludes' or 'excludePatterns'
                                // Common convention for search/tree tools
                                // biome-ignore lint/suspicious/noExplicitAny: Search tool input is dynamic
                                const searchInput = validatedInput as any;
                                searchInput.exclude = excludes;
                                searchInput.excludes = excludes;
                                searchInput.excludePatterns = excludes;
                            }
                        }
                    }
                    // -------------------------

                    // biome-ignore lint/suspicious/noExplicitAny: Context and tool mapping is dynamic
                    const output = await toolItem.execute(validatedInput, toolContext as any);

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
                                            if (
                                                minimatch(line, pattern, { dot: true, matchBase: true })
                                            )
                                                return false;
                                            if (line.includes(pattern)) return false;
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

                    // --- TRUNCATION LOGIC ---
                    let toolOutputValue = typeof output === "string" ? output : JSON.stringify(output);

                    if (toolOutputValue.length > maxToolResponseSize) {
                        const truncated = toolOutputValue.substring(0, maxToolResponseSize);
                        toolOutputValue = `${truncated}\n... [Output truncated. Total size: ${toolOutputValue.length} characters (Limit: ${maxToolResponseSize})]`;
                        logger.warn(`[${this.role}] Tool ${toolName} output truncated from ${toolOutputValue.length} to ${maxToolResponseSize}`);
                    }
                    // ------------------------

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
        }



        // Report Token Usage if linked to a bead
        if (context?.beadId) {
            try {
                const summary = `**Agent Execution Summary**\n- **Role**: ${this.role}\n- **Input Tokens**: ${totalUsage.inputTokens}\n- **Output Tokens**: ${totalUsage.outputTokens}\n- **Total Tokens**: ${totalUsage.totalTokens}`;
                // Usage injected client or global singleton
                const client = this.beadsClient || getBeads();
                client.addComment(context.beadId, summary).catch(err => {
                    logger.warn(`[${this.role}] Failed to report token usage to bead ${context.beadId}`, { error: err });
                });
            } catch (err) {
                logger.warn(`[${this.role}] Error preparing token usage report`, { error: err });
            }
        }

        return finalResult;
    }
}
