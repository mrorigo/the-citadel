import type { LanguageModel } from "ai";
import type { z } from "zod";
import { type AgentContext, CoreAgent } from "../core/agent";
import { type AgentRole } from "../config/schema";
import { getPearls, type PearlsClient } from "../core/pearls";
import { getFormulaRegistry } from "../core/formula";
import { logger } from "../core/logger";
import { jsonSchemaToZod } from "../core/schema-utils";
import { runCommandTool } from "../tools/shell";
import {
    createDelegateTaskTool,
    createReportProgressTool,
    createSubmitWorkTool,
} from "../tools/worker";
import { createInspectResultTool } from "../tools/inspection";

export class WorkerAgent extends CoreAgent {
    constructor(role: AgentRole = "worker", model?: LanguageModel, pearlsClient?: PearlsClient) {
        super(role, model, pearlsClient);
        this.requiresExplicitCompletion = true;

        // --- Shell Execution (Static) ---
        this.registerTool(
            runCommandTool.name,
            runCommandTool.description,
            runCommandTool.schema,
            runCommandTool.handler,
        );

        // Register default tools for easy access/discovery
        this.registerSdkTool("submit_work", createSubmitWorkTool({}, undefined, this.pearlsClient));
        this.registerSdkTool("report_progress", createReportProgressTool({}, this.pearlsClient));
        this.registerSdkTool("delegate_task", createDelegateTaskTool({}, this.pearlsClient));
        this.registerSdkTool("inspect_result", createInspectResultTool({}, this.pearlsClient));
    }

    protected override async getDynamicTools(
        context?: AgentContext,
    ): Promise<Record<string, import("ai").Tool>> {
        const ctx = context || {};
        let outputSchema: z.ZodTypeAny | undefined;

        if (ctx.pearlId) {
            try {
                const pearl = await getPearls().get(ctx.pearlId);
                const stepIdx = pearl.labels
                    ?.find((l) => l.startsWith("step:"))
                    ?.split(":")[1];
                const formulaName = pearl.labels
                    ?.find((l) => l.startsWith("formula:"))
                    ?.split(":")[1];

                if (stepIdx && formulaName) {
                    const formula = getFormulaRegistry().get(formulaName);
                    const step = formula?.steps.find((s) => s.id === stepIdx);
                    if (step?.output_schema) {
                        outputSchema = jsonSchemaToZod(step.output_schema);
                        logger.debug(
                            `[Worker] Loaded output schema for ${ctx.pearlId} from ${formulaName}:${stepIdx}`,
                        );
                    }
                }
            } catch (err) {
                logger.warn(
                    `[Worker] Failed to resolve schema for ${ctx.pearlId}: ${err}`,
                );
            }
        }

        return {
            submit_work: createSubmitWorkTool(ctx, outputSchema, this.pearlsClient),
            report_progress: createReportProgressTool(ctx, this.pearlsClient),
            delegate_task: createDelegateTaskTool(ctx, this.pearlsClient),
            inspect_result: createInspectResultTool(ctx, this.pearlsClient),
        };
    }

    override async run(
        prompt: string,
        context?: Record<string, unknown>,
    ): Promise<string> {
        return super.run(prompt, context);
    }

    protected override getSystemPrompt(defaultPrompt: string): string {
        return `${defaultPrompt}

# Guidelines
1. **Tool-First**: Always prefer tools over manual reasoning if a tool exists.
2. **Persistence**: Use \`report_progress\` for long-running tasks.
3. **Completion**: You MUST call \`submit_work\` to finish. Include a concise \`summary\` of changes.
4. **Filesystem**: 
   - Before editing, use \`filesystem:list_directory\` or \`filesystem:directory_tree\` to understand the project structure.
   - Use atomic edits. Avoid overwriting entire files unless necessary.
   - Respect the exclusion patterns (node_modules, .git, etc.) automatically enforced by your tools.`;
    }
}
