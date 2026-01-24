import { existsSync } from 'fs';
import { resolve } from 'path';
import { ConfigSchema, type FoundryConfig } from './schema';
import dotenv from 'dotenv';

// Load .env immediately
dotenv.config();

let configCache: FoundryConfig | null = null;

export async function loadConfig(): Promise<FoundryConfig> {
    if (configCache) return configCache;

    const configPath = resolve(process.cwd(), 'foundry.config.ts');
    let userConfig: Partial<FoundryConfig> = {};

    if (existsSync(configPath)) {
        try {
            // Dynamic import of the config file
            const imported = await import(configPath);
            userConfig = imported.default || {};
        } catch (error) {
            console.warn('Failed to load foundry.config.ts:', error);
        }
    }

    // Merge with ENV vars and defaults via Zod
    // Note: Deep merging logic is simplified here; strict Zod types handle defaults
    const mergedConfig = {
        ...userConfig,
        env: process.env.FOUNDRY_ENV || userConfig.env,
        providers: {
            ...userConfig.providers,
            ollama: {
                baseURL: process.env.FOUNDRY_OLLAMA_BASE_URL || userConfig.providers?.ollama?.baseURL,
                apiKey: process.env.FOUNDRY_OLLAMA_API_KEY || userConfig.providers?.ollama?.apiKey,
                ...userConfig.providers?.ollama
            },
            openai: {
                apiKey: process.env.OPENAI_API_KEY || userConfig.providers?.openai?.apiKey,
                ...userConfig.providers?.openai
            },
            anthropic: {
                apiKey: process.env.ANTHROPIC_API_KEY || userConfig.providers?.anthropic?.apiKey,
                ...userConfig.providers?.anthropic
            }
        }
    };

    const parsed = ConfigSchema.safeParse(mergedConfig);

    if (!parsed.success) {
        console.error('Configuration Validation Failed:', parsed.error.format());
        throw new Error('Invalid Foundry Configuration');
    }

    configCache = parsed.data;
    return configCache;
}

export function getConfig(): FoundryConfig {
    if (!configCache) {
        throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return configCache;
}
