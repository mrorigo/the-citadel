import { describe, it, expect, mock, beforeEach } from 'bun:test';

// 1. Mock modules BEFORE importing the code that uses them
mock.module('@modelcontextprotocol/sdk/types.js', () => ({
    ReadResourceRequestSchema: {},
    ListResourcesRequestSchema: {},
    ListRootsRequestSchema: {}
}));

mock.module('../../src/services/mcp', () => ({
    getMCPService: mock(() => ({
        readResource: mock(async (server: string, uri: string) => [`Injected content from ${server}:${uri}`]),
        initialize: mock(async () => { }),
        shutdown: mock(async () => { })
    }))
}));

const mockBead = {
    id: 'test-bead',
    labels: ['formula:test-formula'],
    context: {
        mcp_resources: {
            'bead-server': ['bead://uri']
        }
    }
};

mock.module('../../src/core/beads', () => ({
    getBeads: mock(() => ({
        get: mock(async () => mockBead)
    })),
    setBeadsInstance: mock(() => { })
}));

mock.module('../../src/core/formula', () => ({
    getFormulaRegistry: mock(() => ({
        get: mock((name: string) => {
            if (name === 'test-formula') {
                return {
                    formula: 'test-formula',
                    mcp_resources: {
                        'formula-server': ['formula://uri']
                    }
                };
            }
            return null;
        })
    }))
}));

// 2. Now import the code
import { getInstructionService } from '../../src/core/instruction';
import { setConfig } from '../../src/config';

describe('MCP Resource Injection Integration', () => {
    beforeEach(() => {
        // Setup initial config with all required fields
        setConfig({
            providers: {},
            agents: {
                worker: {
                    provider: 'ollama',
                    model: 'llama3',
                    mcpResources: {
                        'config-server': ['config://uri']
                    }
                },
                router: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: {
                timeout: 300,
                maxRetries: 3,
                costLimit: 1.0,
                min_workers: 1,
                max_workers: 5,
                load_factor: 1.0
            },
            gatekeeper: {
                min_workers: 1,
                max_workers: 5,
                load_factor: 1.0
            },
            beads: { path: '.beads', binary: 'bd' }
        } as any);
    });

    it('should inject resources from config, formula, and bead context into the final prompt', async () => {
        const service = getInstructionService();
        const prompt = await service.buildPrompt({
            role: 'worker',
            beadId: 'test-bead'
        }, 'Base prompt.');

        expect(prompt).toContain('Base prompt.');
        expect(prompt).toContain('# CONTEXT RESOURCES');

        // From Config
        expect(prompt).toContain('## RESOURCE: config-server:config://uri');
        expect(prompt).toContain('Injected content from config-server:config://uri');

        // From Formula
        expect(prompt).toContain('## RESOURCE: formula-server:formula://uri');
        expect(prompt).toContain('Injected content from formula-server:formula://uri');

        // From Bead Context
        expect(prompt).toContain('## RESOURCE: bead-server:bead://uri');
        expect(prompt).toContain('Injected content from bead-server:bead://uri');
    });
});
