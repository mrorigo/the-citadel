import { z } from "zod";

export const ConfigSchema = z.object({
	env: z.enum(["development", "production"]).default("development"),

	providers: z.object({
		openai: z
			.object({
				apiKey: z.string().optional(),
			})
			.optional(),
		anthropic: z
			.object({
				apiKey: z.string().optional(),
			})
			.optional(),
		ollama: z
			.object({
				baseURL: z.string().default("http://localhost:11434/v1"),
				apiKey: z.string().default("ollama"),
			})
			.optional(),
	}),

	agents: z.object({
		router: z.object({
			provider: z.enum(["openai", "anthropic", "ollama"]),
			model: z.string(),
			mcpTools: z.array(z.string()).optional(), // Format: ["server:tool", "server:*"]
		}),
		worker: z.object({
			provider: z.enum(["openai", "anthropic", "ollama"]),
			model: z.string(),
			mcpTools: z.array(z.string()).optional(),
		}),
		supervisor: z.object({
			provider: z.enum(["openai", "anthropic", "ollama"]),
			model: z.string(),
			mcpTools: z.array(z.string()).optional(),
		}),
		gatekeeper: z.object({
			provider: z.enum(["openai", "anthropic", "ollama"]),
			model: z.string(),
			mcpTools: z.array(z.string()).optional(),
		}),
	}),

	mcpServers: z
		.record(
			z.string(),
			z
				.object({
					command: z.string().optional(),
					args: z.array(z.string()).optional(),
					env: z.record(z.string(), z.string()).optional(),
					url: z.string().optional(),
					headers: z.record(z.string(), z.string()).optional(),
				})
				.refine((data) => data.command || data.url, {
					message:
						"MCP server must have either a command (stdio) or a url (http)",
				}),
		)
		.optional(),

	worker: z.object({
		timeout: z.number().default(300),
		maxRetries: z.number().default(3),
		costLimit: z.number().default(1.0),
		min_workers: z.number().default(1),
		max_workers: z.number().default(5),
		load_factor: z.number().default(1.0),
	}),

	gatekeeper: z
		.object({
			min_workers: z.number().default(1),
			max_workers: z.number().default(5),
			load_factor: z.number().default(1.0),
		})
		.default({
			min_workers: 1,
			max_workers: 5,
			load_factor: 1.0,
		}),

	beads: z.object({
		path: z.string().default(".beads"),
		binary: z.string().default("bd"),
		autoSync: z.boolean().default(true),
	}),

	bridge: z
		.object({
			maxLogs: z.number().default(1000),
		})
		.default({ maxLogs: 1000 }),
});

export type CitadelConfig = z.infer<typeof ConfigSchema>;
export type CitadelConfigInput = z.input<typeof ConfigSchema>;
export type AgentRole = keyof CitadelConfig["agents"];

export function defineConfig(config: CitadelConfigInput): CitadelConfigInput {
	return config;
}
