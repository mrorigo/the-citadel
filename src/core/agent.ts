import { generateText, tool, type Tool, type LanguageModel } from 'ai';
import { getAgentModel } from './llm';
import type { AgentRole } from '../config/schema';
import type { z } from 'zod';

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
        } as any);
    }

    /**
     * The Thinking Step: Analyzes the input and produces a plan/reasoning.
     * Does NOT have access to tools, forcing pure reasoning.
     */
    protected getSystemPrompt(_phase: 'think' | 'act', defaultPrompt: string): string {
        return defaultPrompt;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI SDK toolChoice type
    protected getToolChoice(): any | undefined {
        return undefined;
    }

    /**
     * The Thinking Step: Analyzes the input and produces a plan/reasoning.
     * Does NOT have access to tools, forcing pure reasoning.
     */
    protected async think(prompt: string, context?: AgentContext): Promise<string> {
        const defaultSystem = `You are a ${this.role}. Your job is to ANALYZE the request and PLAN the execution.
            Do NOT execute actions yet. Output your reasoning and plan.`;

        const { text } = await generateText({
            model: this.model,
            system: this.getSystemPrompt('think', defaultSystem),
            prompt: `Context: ${JSON.stringify(context || {})}\n\nRequest: ${prompt}`,
        });
        return text;
    }

    /**
     * The Acting Step: Executes the plan using available tools.
     */
    protected async act(plan: string, context?: AgentContext): Promise<string> {
        const defaultSystem = `You are a ${this.role}. Execute the following plan using your tools.
            Context: ${JSON.stringify(context || {})}`;

        // Vercel AI SDK generateText with tools and maxSteps handles the loop
        const { text, toolCalls, finishReason } = await generateText({
            model: this.model,
            tools: this.tools,
            system: this.getSystemPrompt('act', defaultSystem),
            prompt: `Plan: ${plan}`,
            maxSteps: 5, // Allow multi-step tool use
            toolChoice: this.getToolChoice(),
            // biome-ignore lint/suspicious/noExplicitAny: Cast to any to avoid maxSteps type error if strict
        } as any);

        console.log(`[CoreAgent] Act finished. Reason: ${finishReason}. Tools called: ${toolCalls?.length || 0}`);
        if (toolCalls?.length) {
            console.log('[CoreAgent] Tools:', JSON.stringify(toolCalls, null, 2));
        }

        return text;
    }

    /**
     * Main entry point
     */
    async run(prompt: string, context?: AgentContext): Promise<string> {
        console.log(`[${this.role}] Thinking...`);
        const plan = await this.think(prompt, context);
        console.log(`[${this.role}] Plan:`, plan);

        console.log(`[${this.role}] Acting...`);
        const result = await this.act(plan, context);
        return result;
    }
}
