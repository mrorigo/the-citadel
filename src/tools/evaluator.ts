import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "../core/agent";
import { getBeads } from "../core/beads";

export const createApproveWorkTool = (_context: AgentContext) => {
    const parameters = z.object({
        acceptance_test: z
            .union([z.string(), z.array(z.string())])
            .describe("The acceptance criteria/test that passed"),
        feedback: z.string().optional().describe("Optional feedback or comments"),
    });

    return tool({
        description: "Approve the submitted work, marking the task as Done",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const { acceptance_test, feedback } = args;
            const beadId = toolContext.beadId;
            if (!beadId)
                throw new Error("No beadId found in context");

            const testStr = Array.isArray(acceptance_test)
                ? acceptance_test.join("\n")
                : acceptance_test;
            const finalTest = feedback
                ? `${testStr}\nFeedback: ${feedback}`
                : testStr;
            await getBeads().update(beadId, {
                status: "done",
                acceptance_test: finalTest,
            });
            return { success: true, message: `Approved work for ${beadId}` };
        },
    });
};

export const createRejectWorkTool = (_context: AgentContext) => {
    const parameters = z.object({
        reason: z.string().describe("Reason for rejection"),
        feedback: z
            .string()
            .describe("Constructive feedback to help the worker fix the issue"),
    });

    return tool({
        description: "Reject the work and send it back to the Worker",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const { reason: _reason, feedback: _feedback } = args;
            const beadId = toolContext.beadId;
            if (!beadId)
                throw new Error("No beadId found in context");

            const bead = await getBeads().get(beadId);
            const labels = new Set(bead.labels || []);
            labels.add("rejected");

            await getBeads().update(beadId, {
                status: "open",
                labels: Array.from(labels),
            });

            return {
                success: true,
                message: `Rejected work for ${beadId}. Sent back to worker.`,
            };
        },
    });
};

export const createFailWorkTool = (_context: AgentContext) => {
    const parameters = z.object({
        reason: z.string().describe("Reason for failure"),
    });

    return tool({
        description: "Mark the task as completely Failed (irrecoverable)",
        inputSchema: parameters,
        // biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
        execute: async (args: z.infer<typeof parameters>, toolContext: any) => {
            const { reason: _reason } = args;
            const beadId = toolContext.beadId;
            if (!beadId)
                throw new Error("No beadId found in context");

            const bead = await getBeads().get(beadId);
            const labels = new Set(bead.labels || []);
            labels.add("failed");

            await getBeads().update(beadId, {
                status: "done",
                labels: Array.from(labels),
            });

            return { success: true, message: `Marked ${beadId} as failed` };
        },
    });
};
