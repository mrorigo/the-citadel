import type { LanguageModel } from "ai";
import { type AgentContext, CoreAgent } from "../core/agent";
import {
    createApproveWorkTool,
    createFailWorkTool,
    createRejectWorkTool,
} from "../tools/evaluator";
import { runCommandTool } from "../tools/shell";

export class EvaluatorAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super("gatekeeper", model);
        this.requiresExplicitCompletion = true;

        // --- Shell Execution (Static) ---
        this.registerTool(
            runCommandTool.name,
            runCommandTool.description,
            runCommandTool.schema,
            runCommandTool.handler,
        );

        // Register default tools for easy access/discovery
        this.registerSdkTool("approve_work", createApproveWorkTool({}));
        this.registerSdkTool("reject_work", createRejectWorkTool({}));
        this.registerSdkTool("fail_work", createFailWorkTool({}));
    }

    protected override async getDynamicTools(
        context?: AgentContext,
    ): Promise<Record<string, import("ai").Tool>> {
        const ctx = context || {};
        return {
            approve_work: createApproveWorkTool(ctx),
            reject_work: createRejectWorkTool(ctx),
            fail_work: createFailWorkTool(ctx),
        };
    }
    protected override getSystemPrompt(defaultPrompt: string): string {
        return defaultPrompt;
    }
}
