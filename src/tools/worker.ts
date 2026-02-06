import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "../core/agent";
import { getBeads } from "../core/beads";
import { logger } from "../core/logger";
import { getQueue } from "../core/queue";

export const createSubmitWorkTool = (
    _context: AgentContext,
    outputSchema?: z.ZodTypeAny,
) => {
    const parameters = z.object({
        summary: z
            .string()
            .optional()
            .describe("Summary of work done (required if not in output)"),
        output: z
            .union([z.string(), outputSchema || z.record(z.string(), z.unknown())])
            .optional()
            .describe("Output data"),
        acceptance_test_result: z.optional(
            z.string().describe("Result of running the acceptance test"),
        ),
    });

    return tool({
        description: "Submit the completed work for verification",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            let { summary, output, acceptance_test_result: _acceptance_test_result } =
                args;
            const beadId = toolContext.beadId;
            if (!beadId) throw new Error("No beadId found in context");

            // Auto-Extraction: Recover summary if nested in output (common agent error)
            if (!summary && typeof output === "object" && output !== null) {
                const outObj = output as Record<string, unknown>;
                if (typeof outObj.summary === "string") {
                    summary = outObj.summary;
                    logger.info(
                        `[Worker] Auto-extracted summary from output.summary for ${beadId}`,
                    );
                } else if (typeof outObj.analysis === "string") {
                    // Common pattern in planning steps
                    summary = outObj.analysis;
                    logger.info(
                        `[Worker] Auto-extracted summary from output.analysis for ${beadId}`,
                    );
                } else if (Object.keys(outObj).length > 0) {
                    const keys = Object.keys(outObj).slice(0, 3).join(", ");
                    summary = `Completed work with structured output (keys: ${keys}...)`;
                    logger.warn(
                        `[Worker] No summary found. Generated fallback summary for ${beadId}`,
                    );
                }
            }

            if (!summary) {
                if (typeof output === "string" && output.length > 0) {
                    summary =
                        output.length > 100 ? `${output.substring(0, 97)}...` : output;
                } else {
                    throw new Error(
                        "Missing required field: 'summary'. Please provide a brief summary of the work completed, or ensure 'output' contains meaningful data.",
                    );
                }
            }

            // Validate ticket exists FIRST (before any state changes)
            const ticket = getQueue().getActiveTicket(beadId);
            if (!ticket) {
                try {
                    const bead = await getBeads().get(beadId);
                    if (bead.status === "verify" || bead.status === "done") {
                        logger.info(
                            `[Worker] Idempotency: Work for ${beadId} already submitted. Returning success.`,
                        );
                        return {
                            success: true,
                            status: bead.status,
                            message: "Work already submitted successfully.",
                            summary,
                        };
                    }
                    const savedOutput = getQueue().getOutput(beadId);
                    if (savedOutput) {
                        logger.warn(
                            `[Worker] Recovery: Bead ${beadId} stuck in '${bead.status}' despite completed ticket. Forcing transition to 'verify'.`,
                        );
                        await getBeads().update(beadId, { status: "verify" });
                        const recoveredSummary =
                            (savedOutput as Record<string, unknown>)?.summary ||
                            "Recovered summary";
                        return {
                            success: true,
                            status: "verify",
                            summary: recoveredSummary,
                            message: "Work submission recovered and verified.",
                        };
                    }
                } catch (err) {
                    logger.debug(`[Worker] Idempotency check failed: ${err}`);
                }
                throw new Error(
                    `No active ticket found for ${beadId}. Cannot submit work.`,
                );
            }

            getQueue().complete(ticket.id, output || { summary });
            logger.info(`[Worker] Submitted work for ${beadId}`, {
                beadId,
                hasOutput: !!output,
            });

            await getBeads().update(beadId, {
                status: "verify",
            });

            return {
                success: true,
                status: "verify",
                summary,
                message: "Work submitted successfully.",
            };
        },
    });
};

// NOTE: This tool should perhaps add history to the bead?
export const createReportProgressTool = (_context: AgentContext) => {
    const parameters = z
        .object({
            message: z.string().optional().describe("Progress message"),
            reasoning: z
                .string()
                .optional()
                .describe("Reasoning or detailed progress"),
        })
        .passthrough();

    return tool({
        description: "Report progress on the current task without submitting it",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const beadId = toolContext.beadId;
            if (!beadId)
                return {
                    success: false,
                    message: "No beadId found in context",
                };

            const msg = args.message || args.reasoning || "Working on it...";
            logger.info(`[Worker] Progress on ${beadId}: ${msg}`);
            await getBeads().update(beadId, { status: "in_progress" });
            return { success: true, message: msg };
        },
    });
};

export const createDelegateTaskTool = (_context: AgentContext) => {
    const parameters = z.object({
        parentBeadId: z
            .string()
            .optional()
            .describe("The ID of the parent bead (optional if in context)"),
        title: z.string().describe("Title of the subtask"),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        tags: z.array(z.string()).optional(),
        description: z
            .string()
            .optional()
            .describe("Detailed description of the subtask"),
    });

    return tool({
        description: "Delegate a subtask to another worker (creating a child bead)",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const {
                title,
                priority,
                tags,
                description,
                parentBeadId: argParentBeadId,
            } = args;
            const parentBeadId = argParentBeadId || toolContext.beadId;

            if (!parentBeadId) {
                return {
                    success: false,
                    error:
                        "Cannot delegate: No active parent bead (missing context and argument)",
                };
            }

            try {
                // Fix: Call create(title, options) correctly
                const bead = await getBeads().create(title, {
                    description: description,
                    labels: [...(tags || []), "delegated"],
                    priority:
                        priority === "critical"
                            ? 0
                            : priority === "high"
                                ? 1
                                : priority === "normal"
                                    ? 2
                                    : 3,
                    parent: parentBeadId, // Note: 'parent', not 'parent_id' based on options interface
                });

                // Establish parent-child dependency (parent depends on child)
                await getBeads().addDependency(parentBeadId, bead.id);

                // Enqueue the child task
                getQueue().enqueue(bead.id, 2, "worker");

                logger.info(
                    `[Worker] Delegated subtask ${bead.id} from ${parentBeadId}`,
                );

                return {
                    success: true,
                    beadId: bead.id,
                    message: `Delegated subtask '${title}' (ID: ${bead.id})`,
                };
            } catch (err: unknown) {
                const error = err as Error;
                return {
                    success: false,
                    error: `Failed to delegate: ${error.message}`,
                };
            }
        },
    });
};
