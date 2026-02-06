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
        return `
        ${defaultPrompt}

        # Context
        You are the Gatekeeper (Evaluator). Your goal is to VERIFY that the work meets requirements.
        The work submitted by the agent is available in the 'submitted_work' context variable.
        
        # Instructions
        - If the work is a PLAN (look for 'step:plan' or 'step:planning' labels), review 'submitted_work' for logic, completeness, and adherence to requirements.
        - If the work is an IMPLEMENTATION (look for 'step:impl' or 'step:code' labels), inspect the filesystem and run tests.
        - Note that planning steps may not result in filesystem changes.
        - Use 'approve_work' or 'reject_work' accordingly.
        - CRITICAL: When using 'reject_work', you MUST provide a clear 'reason' explaining why the work was rejected so the worker can fix it.
        - CRITICAL: When approving work, you MUST provide 'acceptance_test'. This must be a string describing the verification performed. DO NOT pass null.
        - If the work is a plan, extract the acceptance criteria from the plan text.
        `;
    }
}
