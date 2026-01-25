import { generateText, tool, type Tool, type LanguageModel, type ModelMessage, type ToolCallPart, type ToolResultPart, type TextPart } from 'ai';
import { getAgentModel } from './llm';
import type { AgentRole } from '../config/schema';
import type { z } from 'zod';
import { logger } from './logger';
import { getProjectContext } from '../services/project-context';

export interface AgentContext {
    beadId?: string;
    // biome-ignore lint/suspicious/noExplicitAny: Context bag is flexible
    [key: string]: any;
}

export abstract class CoreAgent {
    protected role: AgentRole;
    protected model: LanguageModel;
    protected tools: Record<string, Tool> = {};

    constructor(role: AgentRole) {
        this.role = role;
        this.model = getAgentModel(role);
    }

    // biome-ignore lint/suspicious/noExplicitAny: Generic tool schema
    protected registerTool<T extends z.ZodType<any>>(name: string, description: string, schema: T, execute: (args: z.infer<T>) => Promise<any>) {
        this.tools[name] = tool({
            description,
            parameters: schema,
            // biome-ignore lint/suspicious/noExplicitAny: Casting for tool compatibility
            execute: execute as any,
            // biome-ignore lint/suspicious/noExplicitAny: Casting for tool compatibility
        } as any);
    }

    /**
     * Override this to provide the system prompt.
     */
    protected getSystemPrompt(defaultPrompt: string): string {
        return defaultPrompt;
    }

    /**
     * The Unified Loop:
     * - Loads Project Context (AGENTS.md)
     * - Runs a manual loop interacting with the LLM
     * - Handles tool execution manually for better control/logging
     */
    async run(prompt: string, context?: AgentContext): Promise<string> {
        logger.info(`[${this.role}] Running...`, { role: this.role });

        // 1. Load Project Awareness
        const projectContext = await getProjectContext().resolveContext(process.cwd(), process.cwd());

        let projectRules = '';
        if (projectContext) {
            logger.info(`[${this.role}] Loaded AGENTS.md from ${projectContext.sourcePath}`);
            projectRules = `
            # PROJECT RULES (AGENTS.md)
            You must follow these rules from the project configuration:
            
            ## Raw Configuration
            ${projectContext.config.raw}

            ## Parsed Commands & Rules (Reference)
            ${projectContext.config.rules.length > 0 ? `### Extracted Rules\n${projectContext.config.rules.map(r => `- ${r}`).join('\n')}` : ''}
            
            ${projectContext.config.commands.setup.length > 0 ? `### Setup Commands\n${projectContext.config.commands.setup.map(c => `- ${c}`).join('\n')}` : ''}
            ${projectContext.config.commands.test.length > 0 ? `### Test Commands\n${projectContext.config.commands.test.map(c => `- ${c}`).join('\n')}` : ''}
            ${projectContext.config.commands.lint.length > 0 ? `### Lint Commands\n${projectContext.config.commands.lint.map(c => `- ${c}`).join('\n')}` : ''}
            ${projectContext.config.commands.build.length > 0 ? `### Build Commands\n${projectContext.config.commands.build.map(c => `- ${c}`).join('\n')}` : ''}
            
            Always prioritize these project-specific instructions over general knowledge.
            `;
        }

        const baseSystem = `You are a ${this.role}. Execute the request.
        
        # Tools
        You have access to tools. You MUST use them to perform actions.
        
        ${projectRules}
        `;

        const system = this.getSystemPrompt(baseSystem);

        const messages: ModelMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: `Context: ${JSON.stringify(context || {})}\n\nRequest: ${prompt}` }
        ];

        let finalResult = '';

        // Max steps 50 to prevent infinite loops but allow complex tasks
        for (let i = 0; i < 50; i++) {
            const result = await generateText({
                model: this.model,
                tools: this.tools,
                messages: messages,
            });

            // Construct Assistant Message from result
            // We must manually add the assistant's response to history so the subsequent tool-result message is valid.
            const assistantContent: (TextPart | ToolCallPart)[] = [];
            if (result.text) {
                assistantContent.push({ type: 'text', text: result.text });
            }
            if (result.toolCalls && result.toolCalls.length > 0) {
                assistantContent.push(...result.toolCalls.map((tc) => ({
                    type: 'tool-call' as const,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input
                })));
            }

            // Only push if there is content
            if (assistantContent.length > 0) {
                messages.push({ role: 'assistant', content: assistantContent });
            }

            finalResult = result.text;

            // Log output
            if (result.text) {
                logger.info(`[${this.role}] Output`, { text: result.text });
            }

            const toolCalls = result.toolCalls;

            // If no tools, we might be done
            if (!toolCalls || toolCalls.length === 0) {
                // If the model produced a final text response without tools, we can stop?
                // Or we can let it continue if we feel like it. 
                // For now, if no tools, we are mostly done unless the prompt forces more.
                // But let's check if the text implies completion? Hard to know.
                // Let's assume: No tools = explicit answer = done.
                break;
            }

            // Execute tools
            const toolResults: ToolResultPart[] = [];
            let finished = false;

            for (const tc of toolCalls) {
                logger.info(`[${this.role}] Executing tool: ${tc.toolName}`, { tool: tc.toolName, params: tc.input });

                const tool = this.tools[tc.toolName];
                if (!tool) {
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: `Tool ${tc.toolName} not found` },
                    } as ToolResultPart);
                    continue;
                }

                if (!tool.execute) {
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: `Tool ${tc.toolName} has no execute method` },
                    } as ToolResultPart);
                    continue;
                }

                try {
                    // biome-ignore lint/suspicious/noExplicitAny: Internal execution
                    const output = await tool.execute(tc.input || {}, { toolCallId: tc.toolCallId, messages } as any);

                    // Check for explicit finish signals if tool returns them? 
                    // Not standard, but we can convention.
                    // Or check specific tool names.
                    if (tc.toolName === 'submit_work' || tc.toolName === 'approve_work' || tc.toolName === 'reject_work' || tc.toolName === 'enqueue_task') {
                        finished = true;
                    }

                    const toolOutput = typeof output === 'string'
                        ? { type: 'text' as const, value: output }
                        : { type: 'json' as const, value: output };

                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: toolOutput,
                    } as ToolResultPart);
                } catch (error: unknown) { // Using unknown
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: errorMessage },
                    } as ToolResultPart);
                }
            }

            messages.push({ role: 'tool', content: toolResults });

            if (finished) {
                logger.info(`[${this.role}] Task finished explicitly via tool.`);
                break;
            }
        }

        return finalResult;
    }
}
