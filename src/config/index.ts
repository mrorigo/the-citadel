import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type CitadelConfig } from './schema';
import dotenv from 'dotenv';


// Load .env immediately
dotenv.config();

let configCache: CitadelConfig | null = null;

export async function loadConfig(): Promise<CitadelConfig> {
    if (configCache) return configCache;

    // Default: citadel.config.ts in CWD
    const configPath = resolve(process.cwd(), 'citadel.config.ts');
    let userConfig: Partial<CitadelConfig> = {};

    if (existsSync(configPath)) {
        try {
            // dynamic import
            const mod = await import(configPath);
            userConfig = mod.default || {};
            // If they used defineConfig, it just returns the object
        } catch (error) {
            console.warn('Failed to load citadel.config.ts:', error);
        }
    }

    // Merge with Env Vars (Env takes precedence over file default, config file takes precedence over code default)
    // Actually, typical pattern: Env > Config File > Default
    const rawConfig = {
        ...userConfig,
        env: process.env.CITADEL_ENV || userConfig.env,
        providers: {
            // Start simple
            ollama: {
                baseURL: process.env.CITADEL_OLLAMA_BASE_URL || userConfig.providers?.ollama?.baseURL,
                apiKey: process.env.CITADEL_OLLAMA_API_KEY || userConfig.providers?.ollama?.apiKey,
                ...userConfig.providers?.ollama
            },
            openai: {
                apiKey: process.env.OPENAI_API_KEY || userConfig.providers?.openai?.apiKey,
                ...userConfig.providers?.openai
            },
            anthropic: {
                apiKey: process.env.ANTHROPIC_API_KEY || userConfig.providers?.anthropic?.apiKey,
                ...userConfig.providers?.anthropic
            },
            ...userConfig.providers
        },
    };

    const parsed = ConfigSchema.safeParse(rawConfig);

    if (!parsed.success) {
        console.error('Configuration Error:', parsed.error.format());
        throw new Error('Invalid Citadel Configuration');
    }

    configCache = parsed.data;
    console.log('[Config] Loaded from file/env');
    return configCache;
}

export function setConfig(config: CitadelConfig) {
    console.log('[Config] Manually set config');
    configCache = config;
}

export function getConfig(): CitadelConfig {
    if (!configCache) {
        console.error('[Config] Error: Config accessed before load');
        throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return configCache;
}
