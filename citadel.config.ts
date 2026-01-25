import { defineConfig } from './src/config/schema';

export default defineConfig({
    env: 'development',

    // Provider configurations
    providers: {
        ollama: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
        },
    },

    // Per-agent model configuration
    agents: {
        router: {
            provider: 'ollama',
            model: 'gpt-oss:20b-cloud',
        },
        worker: {
            provider: 'ollama',
            model: 'gpt-oss:20b-cloud',
        },
        supervisor: {
            provider: 'ollama',
            model: 'gpt-oss:120b-cloud',
        },
        gatekeeper: {
            provider: 'ollama',
            model: 'gpt-oss:120b-cloud',
        },
    },

    // Worker settings
    worker: {
        timeout: 300,
        maxRetries: 3,
        costLimit: 1.00,
    },

    // Beads integration
    beads: {
        path: '.beads',
        autoSync: true,
    },

    bridge: {
        maxLogs: 1000,
    },
});
