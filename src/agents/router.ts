import type { LanguageModel } from "ai";
import { type AgentContext, CoreAgent } from "../core/agent";
import {
    createEnqueueTaskTool,
    createInstantiateFormulaTool,
} from "../tools/router";

export class RouterAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super("router", model);
        this.requiresExplicitCompletion = true;

        // Register default tools for easy access/discovery
        this.registerSdkTool("enqueue_task", createEnqueueTaskTool({}));
        this.registerSdkTool(
            "instantiate_formula",
            createInstantiateFormulaTool({}),
        );
    }

    protected override async getDynamicTools(
        context?: AgentContext,
    ): Promise<Record<string, import("ai").Tool>> {
        const ctx = context || {};
        return {
            enqueue_task: createEnqueueTaskTool(ctx),
            instantiate_formula: createInstantiateFormulaTool(ctx),
        };
    }

    protected override getSystemPrompt(defaultPrompt: string): string {
        return `
        ${defaultPrompt}

        # Available Queues
        - 'worker': For implementation, coding, and general tasks (status: 'open').
        - 'gatekeeper': For verification and testing tasks (status: 'verify').
        - 'formula': specialized workflows defined in .citadel/formulas/ (e.g., system_migration).

        # Instructions
        - Analyze the Request and Context.
        - Decide which queue to route to based on the bead status.
        - Decide the priority (0=Critical, 1=High, 2=Normal, 3=Low).
        - Call 'enqueue_task' with the correct queue parameter.
        - Use 'instantiate_formula' if the request matches a known formula.
        `;
    }
}
