import { tool } from "ai";
import { z } from "zod";
import { logger } from "../core/logger";
import { getQueue } from "../core/queue";
import { getWorkflowEngine } from "../services/workflow-engine";
import type { AgentContext } from "../core/agent";

export const createEnqueueTaskTool = (_context: AgentContext) => {
    const parameters = z.object({
        beadId: z
            .string()
            .optional()
            .describe("The ID of the bead to enqueue (defaults to current bead)"),
        reasoning: z.string().describe("Why this task should be enqueued"),
        queue: z
            .enum(["worker", "gatekeeper"])
            .describe("REQUIRED: worker for open tasks, gatekeeper for verify tasks"),
        priority: z
            .number()
            .min(0)
            .max(3)
            .optional()
            .describe("Priority (0-3, default 2)"),
    });

    return tool({
        description:
            'Enqueue a bead for execution. Use queue="worker" for open tasks, queue="gatekeeper" for verify tasks.',
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const beadId = args.beadId || toolContext.beadId;
            if (!beadId) {
                return {
                    success: false,
                    error: "beadId must be provided either as parameter or in context",
                };
            }

            try {
                const active = getQueue().getActiveTicket(beadId);
                if (active) {
                    if (active.target_role === args.queue) {
                        return {
                            success: true,
                            message: `Bead ${beadId} is already in ${args.queue} queue (ticket ${active.id})`,
                        };
                    }
                    return {
                        success: false,
                        error: `Bead ${beadId} already has an active ticket (${active.id}) for role ${active.target_role}`,
                    };
                }

                getQueue().enqueue(beadId, args.priority ?? 2, args.queue);
                return {
                    success: true,
                    message: `Enqueued ${beadId} to ${args.queue}`,
                };
            } catch (error: unknown) {
                const err = error as Error;
                return { success: false, error: err.message };
            }
        },
    });
};

export const createInstantiateFormulaTool = (_context: AgentContext) => {
    const parameters = z.object({
        beadId: z
            .string()
            .optional()
            .describe(
                "The ID of the bead to instantiate the formula for (optional if in context)",
            ),
        formulaName: z.string().describe("The name of the formula to run"),
        variables: z
            .object({})
            .passthrough()
            .optional()
            .default({})
            .describe("Variables to inject into the formula"),
        parentConvoyId: z
            .string()
            .optional()
            .describe("ID of the Convoy to assign this molecule to (optional)"),
    });

    return tool({
        description:
            "Instantiate a named workflow formula (e.g., system_migration)",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const {
                formulaName,
                variables,
                parentConvoyId,
                beadId: argBeadId,
            } = args;
            const beadId = argBeadId || toolContext.beadId;
            // Note: beadId is optional here for backward compat, but log it if present
            if (beadId)
                logger.info(
                    `[Router] Instantiating formula ${formulaName} for bead ${beadId}`,
                );

            try {
                const moleculeId = await getWorkflowEngine().instantiateFormula(
                    formulaName,
                    variables as Record<string, string>,
                    parentConvoyId,
                );
                return { success: true, moleculeId, status: "created" };
            } catch (error: unknown) {
                const err = error as Error;
                return { success: false, error: err.message };
            }
        },
    });
};
