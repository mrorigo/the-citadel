import { z } from 'zod';

export const ConfigSchema = z.object({
  env: z.enum(['development', 'production']).default('development'),

  providers: z.object({
    openai: z.object({
      apiKey: z.string().optional(),
    }).optional(),
    anthropic: z.object({
      apiKey: z.string().optional(),
    }).optional(),
    ollama: z.object({
      baseURL: z.string().default('http://localhost:11434/v1'),
      apiKey: z.string().default('ollama'),
    }).optional(),
  }),

  agents: z.object({
    router: z.object({
      provider: z.enum(['openai', 'anthropic', 'ollama']),
      model: z.string(),
    }),
    worker: z.object({
      provider: z.enum(['openai', 'anthropic', 'ollama']),
      model: z.string(),
    }),
    supervisor: z.object({
      provider: z.enum(['openai', 'anthropic', 'ollama']),
      model: z.string(),
    }),
    gatekeeper: z.object({
      provider: z.enum(['openai', 'anthropic', 'ollama']),
      model: z.string(),
    }),
  }),

  worker: z.object({
    timeout: z.number().default(300),
    maxRetries: z.number().default(3),
    costLimit: z.number().default(1.00),
  }),

  beads: z.object({
    path: z.string().default('.beads'),
    autoSync: z.boolean().default(true),
  }),
});

export type FoundryConfig = z.infer<typeof ConfigSchema>;
export type AgentRole = keyof FoundryConfig['agents'];

export function defineConfig(config: Partial<FoundryConfig>): Partial<FoundryConfig> {
  return config;
}
