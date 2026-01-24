import { generateText, tool, type Tool, type LanguageModel } from 'ai';
import { getAgentModel } from './llm';
import { type AgentRole } from '../config/schema';
import { z } from 'zod';

export interface AgentContext {
    beadId?: string;
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

    protected registerTool<T extends z.ZodType<any>>(name: string, description: string, schema: T, execute: (args: z.infer<T>) => Promise<any>) {
        this.tools[name] = tool({
            description,
            execute: execute as any,
        } as any);
    }

    /**
     * The Thinking Step: Analyzes the input and produces a plan/reasoning.
     * Does NOT have access to tools, forcing pure reasoning.
     */
    protected async think(prompt: string, context?: AgentContext): Promise<string> {
        const { text } = await generateText({
            model: this.model,
            system: `You are a ${this.role}. Your job is to ANALYZE the request and PLAN the execution. 
            Do NOT execute actions yet. Output your reasoning and plan.`,
            prompt: `Context: ${JSON.stringify(context || {})}\n\nRequest: ${prompt}`,
        });
        return text;
    }

    /**
     * The Acting Step: Executes the plan using available tools.
     */
    protected async act(plan: string, context?: AgentContext): Promise<string> {
        // Vercel AI SDK generateText with tools and maxSteps handles the loop
        const { text } = await generateText({
            model: this.model,
            tools: this.tools,
            system: `You are a ${this.role}. Execute the following plan using your tools.
            Context: ${JSON.stringify(context || {})}`,
            prompt: `Plan: ${plan}`,
            maxSteps: 5, // Allow multi-step tool use
        } as any); // Cast to any to avoid maxSteps type error if strict
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
