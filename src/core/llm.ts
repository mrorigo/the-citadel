import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { getConfig } from "../config";

type AgentRole = "router" | "worker" | "supervisor" | "gatekeeper";

export function getAgentModel(role: AgentRole): LanguageModel {
	const config = getConfig();
	const agentConfig = config.agents[role];

	if (!agentConfig) {
		throw new Error(`No configuration found for agent role: ${role}`);
	}

	const { provider, model } = agentConfig;

	switch (provider) {
		case "openai":
			return openai(model);

		case "anthropic":
			return anthropic(model);

		case "ollama": {
			// Create a custom OpenAI instance for Ollama
			if (!config.providers.ollama) {
				throw new Error("Ollama provider configuration is missing");
			}

			const ollama = createOpenAI({
				baseURL: config.providers.ollama.baseURL,
				apiKey: config.providers.ollama.apiKey,
			});

			return ollama(model);
		}

		default:
			throw new Error(`Unsupported provider: ${provider}`);
	}
}
