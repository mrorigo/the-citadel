import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type CitadelConfig, type CitadelConfigInput } from './schema';
import dotenv from 'dotenv';
import { logger } from '../core/logger';
import { getGlobalSingleton, setGlobalSingleton, clearGlobalSingleton } from '../core/registry';


// Load .env immediately
dotenv.config();

const CONFIG_KEY = 'config_cache';

export async function loadConfig(): Promise<CitadelConfig> {
    const existing = getGlobalSingleton<CitadelConfig | null>(CONFIG_KEY, () => null);
    if (existing) return existing;

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

    const config = parsed.data;
    setGlobalSingleton(CONFIG_KEY, config);
    logger.debug('[Config] Loaded from file/env');
    return config;
}

export function setConfig(config: CitadelConfigInput) {
    const parsed = ConfigSchema.parse(config);
    logger.debug('[Config] Manually set config');
    setGlobalSingleton(CONFIG_KEY, parsed);
}

export function resetConfig() {
    clearGlobalSingleton(CONFIG_KEY);
    logger.debug('[Config] Cache cleared');
}

export function getConfig(): CitadelConfig {
    const config = getGlobalSingleton<CitadelConfig | null>(CONFIG_KEY, () => null);
    if (!config) {
        throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return config;
}

