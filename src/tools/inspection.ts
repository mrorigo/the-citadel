import { generateText, tool } from "ai";
import { z } from "zod";
import { getAgentModel } from "../core/llm";
import { getToolResultMemory } from "../core/memory";
import { logger } from "../core/logger";

/**
 * Creates the inspect_result tool.
 * This tool invokes a non-autonomous sub-agent to reason over large tool results stored in memory.
 */
export const createInspectResultTool = () => {
	return tool({
		description:
			"Invokes a non-autonomous sub-agent to reason over a large tool result. Use this for text extraction, summarization, or analysis of offloaded content. The sub-agent has no tools, no autonomy, and cannot perform further tool calls.",
		// biome-ignore lint/suspicious/noExplicitAny: context provided by AI SDK
		execute: async ({ resultId, query }, toolContext: any) => {
			const targetPearlId = toolContext?.pearlId || "default";
			const memory = getToolResultMemory();
			const content = await memory.get(targetPearlId, resultId);

			if (!content) {
				return {
					error: `Tool result with ID ${resultId} not found for pearl ${targetPearlId}.`,
				};
			}

			logger.info(
				`[Inspection] Running sub-agent reasoning for ${resultId} (Query: ${query})`,
			);

			// We default to the worker model for inspection
			const model = getAgentModel("worker");

			const result = await generateText({
				model,
				system:
					"You are a specialized content inspector. You are given a large tool result and a query about it. You MUST analyze the result and provide the requested information. You have no tools, no internet access, and no autonomy beyond answering the specific query about the provided content.",
				prompt: `
CONTENT TO INSPECT (ID: ${resultId}):
---
${content}
---

USER QUERY:
${query}
`,
			});

			return {
				analysis: result.text,
				usage: result.usage,
			};
		},
		inputSchema: z.object({
			resultId: z.string().describe("The unique ID of the offloaded tool result."),
			query: z.string().describe("What you want the sub-agent to find or analyze in the result."),
		}),
	});
};
