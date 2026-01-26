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
            model: 'gpt-oss:120b-cloud',
            mcpTools: ['filesystem:*'],
        },
        supervisor: {
            provider: 'ollama',
            model: 'gpt-oss:120b-cloud',
        },
        gatekeeper: {
            provider: 'ollama',
            model: 'gpt-oss:120b-cloud',
            mcpTools: [
                'filesystem:read_text_file',
                'filesystem:read_multiple_files',
                'filesystem:list_directory',
                'filesystem:list_directory_with_sizes',
                'filesystem:directory_tree',
                'filesystem:search_files',
                'filesystem:get_file_info',
                'filesystem:list_allowed_directories',
            ],
        },
    },

    mcpServers: {
        filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
    },

    // Worker settings
    // Worker settings
    worker: {
        timeout: 1200,
        maxRetries: 3,
        costLimit: 1.00,
        min_workers: 1,
        max_workers: 5,
        load_factor: 1.0,
    },

    gatekeeper: {
        min_workers: 1,
        max_workers: 5,
        load_factor: 1.0,
    },

    // Beads integration
    beads: {
        binary: '/opt/homebrew/bin/bd',
        path: '.beads',
        autoSync: true,
    },

    bridge: {
        maxLogs: 1000,
    },
});
