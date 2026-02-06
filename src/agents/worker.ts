import type { LanguageModel } from "ai";
import type { z } from "zod";
import { type AgentContext, CoreAgent } from "../core/agent";
import { getBeads } from "../core/beads";
import { getFormulaRegistry } from "../core/formula";
import { logger } from "../core/logger";
import { jsonSchemaToZod } from "../core/schema-utils";
import { runCommandTool } from "../tools/shell";
import {
    createDelegateTaskTool,
    createReportProgressTool,
    createSubmitWorkTool,
} from "../tools/worker";

export class WorkerAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super("worker", model);
        this.requiresExplicitCompletion = true;

        // --- Shell Execution (Static) ---
        this.registerTool(
            runCommandTool.name,
            runCommandTool.description,
            runCommandTool.schema,
            runCommandTool.handler,
        );

        // Register default tools for easy access/discovery
        this.registerSdkTool("submit_work", createSubmitWorkTool({}));
        this.registerSdkTool("report_progress", createReportProgressTool({}));
        this.registerSdkTool("delegate_task", createDelegateTaskTool({}));
    }

    protected override async getDynamicTools(
        context?: AgentContext,
    ): Promise<Record<string, import("ai").Tool>> {
        const ctx = context || {};
        let outputSchema: z.ZodTypeAny | undefined;

        if (ctx.beadId) {
            try {
                const bead = await getBeads().get(ctx.beadId);
                const stepIdx = bead.labels
                    ?.find((l) => l.startsWith("step:"))
                    ?.split(":")[1];
                const formulaName = bead.labels
                    ?.find((l) => l.startsWith("formula:"))
                    ?.split(":")[1];

                if (stepIdx && formulaName) {
                    const formula = getFormulaRegistry().get(formulaName);
                    const step = formula?.steps.find((s) => s.id === stepIdx);
                    if (step?.output_schema) {
                        outputSchema = jsonSchemaToZod(step.output_schema);
                        logger.debug(
                            `[Worker] Loaded output schema for ${ctx.beadId} from ${formulaName}:${stepIdx}`,
                        );
                    }
                }
            } catch (err) {
                logger.warn(
                    `[Worker] Failed to resolve schema for ${ctx.beadId}: ${err}`,
                );
            }
        }

        return {
            submit_work: createSubmitWorkTool(ctx, outputSchema),
            report_progress: createReportProgressTool(ctx),
            delegate_task: createDelegateTaskTool(ctx),
        };
    }

    override async run(
        prompt: string,
        context?: Record<string, unknown>,
    ): Promise<string> {
        return super.run(prompt, context);
    }

    protected override getSystemPrompt(defaultPrompt: string): string {
        return `
        ${defaultPrompt}
        
        # Guidelines
        - Use filesystem tools to explore and write code.
        - Run tests with run_command if available.
        - Keep the user informed with report_progress.
        - Submit your work when done with submit_work.
        `;
    }
}
