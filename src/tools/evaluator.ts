import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "../core/agent";
import { getPearls } from "../core/pearls";

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
            const pearlId = toolContext.pearlId;
            if (!pearlId)
                throw new Error("No pearlId found in context");

            const testStr = Array.isArray(acceptance_test)
                ? acceptance_test.join("\n")
                : acceptance_test;
            const finalTest = feedback
                ? `${testStr}\nFeedback: ${feedback}`
                : testStr;
            await getPearls().update(pearlId, {
                status: "done",
                acceptance_test: finalTest,
            });
            const audit = `**Work Approved**\n\n${feedback || "No feedback provided."}`;
            return {
                success: true,
                message: `Approved work for ${pearlId}`,
                audit,
            };
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
            const pearlId = toolContext.pearlId;
            if (!pearlId)
                throw new Error("No pearlId found in context");

            const pearl = await getPearls().get(pearlId);
            const labels = new Set(pearl.labels || []);
            labels.add("rejected");

            await getPearls().update(pearlId, {
                status: "open",
                labels: Array.from(labels),
            });

            const audit = `**Work Rejected**\n\nReason: ${args.reason}\nFeedback: ${args.feedback}`;

            return {
                success: true,
                message: `Rejected work for ${pearlId}. Sent back to worker.`,
                audit,
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
            const pearlId = toolContext.pearlId;
            if (!pearlId)
                throw new Error("No pearlId found in context");

            const pearl = await getPearls().get(pearlId);
            const labels = new Set(pearl.labels || []);
            labels.add("failed");

            await getPearls().update(pearlId, {
                status: "done",
                labels: Array.from(labels),
            });

            const audit = `**Work Failed**\n\nReason: ${args.reason}`;

            return {
                success: true,
                message: `Marked ${pearlId} as failed`,
                audit,
            };
        },
    });
};
