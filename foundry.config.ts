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
            model: 'gpt-oss:120b-cloud',
        },
        worker: {
            provider: 'ollama',
            model: 'qwen3:14b', // Using qwen3:14b as requested by user's ollama ls
        },
        supervisor: {
            provider: 'ollama',
            model: 'llama3.2:3b',
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
});
