import type { LanguageModel } from "ai";
import { type AgentContext, CoreAgent } from "../core/agent";
import {
    createApproveWorkTool,
    createFailWorkTool,
    createRejectWorkTool,
} from "../tools/evaluator";
import { runCommandTool } from "../tools/shell";
import type { PearlsClient } from "../core/pearls";

export class EvaluatorAgent extends CoreAgent {
    constructor(model?: LanguageModel, pearlsClient?: PearlsClient) {
        super("gatekeeper", model, pearlsClient);
        this.requiresExplicitCompletion = true;

        // --- Shell Execution (Static) ---
        this.registerTool(
            runCommandTool.name,
            runCommandTool.description,
            runCommandTool.schema,
            runCommandTool.handler,
        );

        // Register default tools for easy access/discovery
        this.registerSdkTool("approve_work", createApproveWorkTool({}, this.pearlsClient));
        this.registerSdkTool("reject_work", createRejectWorkTool({}, this.pearlsClient));
        this.registerSdkTool("fail_work", createFailWorkTool({}, this.pearlsClient));
    }

    protected override async getDynamicTools(
        context?: AgentContext,
    ): Promise<Record<string, import("ai").Tool>> {
        const ctx = context || {};
        return {
            approve_work: createApproveWorkTool(ctx, this.pearlsClient),
            reject_work: createRejectWorkTool(ctx, this.pearlsClient),
            fail_work: createFailWorkTool(ctx, this.pearlsClient),
        };
    }
    protected override getSystemPrompt(defaultPrompt: string): string {
        return defaultPrompt;
    }
}
