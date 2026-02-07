import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { setGlobalSingleton, clearGlobalSingleton } from '../../src/core/registry';
import { getInstructionService } from '../../src/core/instruction';
import { setConfig, resetConfig } from '../../src/config';
import { setBeadsInstance } from '../../src/core/beads';
import { setFormulaRegistry } from '../../src/core/formula';

// 1. Mock modules BEFORE importing the code that uses them
mock.module('@modelcontextprotocol/sdk/types.js', () => ({
    ReadResourceRequestSchema: {},
    ListResourcesRequestSchema: {},
    ListRootsRequestSchema: {}
}));

const getMockBead = () => ({
    id: 'test-bead',
    labels: ['formula:test-formula'],
    context: {
        mcp_resources: {
            'bead-server': ['bead://uri']
        }
    }
});

describe('MCP Resource Injection Integration', () => {
    beforeEach(() => {
        setGlobalSingleton('mcp_service', {
            readResource: mock(async (server: string, uri: string) => [`Injected content from ${server}:${uri}`]),
            initialize: mock(async () => { }),
            shutdown: mock(async () => { })
        });

        const mockBeads = {
            get: mock(async () => getMockBead()),
            update: mock(async () => getMockBead()),
            create: mock(async () => getMockBead()),
            init: mock(async () => { }),
            mapToDomain: (raw: any) => raw,
        };
        setBeadsInstance(mockBeads as any);

        const mockRegistry = {
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
        };
        setFormulaRegistry(mockRegistry as any);

        // Setup initial config with all required fields
        setConfig({
            env: 'development',
            providers: { ollama: {} },
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
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            beads: { path: '.pearls', binary: 'prl' }
        });
    });

    afterEach(() => {
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        clearGlobalSingleton('mcp_service');
        clearGlobalSingleton('instruction_service');
        resetConfig();
    });

    it('should aggregate resources from config, formula, and bead context', async () => {
        const service = getInstructionService();
        const instructions = await service.buildPrompt({
            role: 'worker',
            beadId: 'test-bead'
        }, "Base prompt");

        expect(instructions).toContain('# CONTEXT RESOURCES');

        // From config
        expect(instructions).toContain('## RESOURCE: config-server:config://uri');
        expect(instructions).toContain('Injected content from config-server:config://uri');

        // From formula
        expect(instructions).toContain('## RESOURCE: formula-server:formula://uri');
        expect(instructions).toContain('Injected content from formula-server:formula://uri');

        // From bead context
        expect(instructions).toContain('## RESOURCE: bead-server:bead://uri');
        expect(instructions).toContain('Injected content from bead-server:bead://uri');
    });

    it('should NOT include resources if none are configured', async () => {
        // Reset everything for this Case
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: {
                worker: { provider: 'ollama', model: 'mock' },
                router: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            beads: { path: '.pearls', binary: 'prl' }
        });

        const testBead = getMockBead();
        testBead.labels = [];
        (testBead.context as any) = {};

        // We need to update the mock to return OUR manipulated bead for this test
        const mockBeads = {
            get: mock(async () => testBead),
            update: mock(async () => testBead),
            create: mock(async () => testBead),
            init: mock(async () => { }),
            mapToDomain: (raw: any) => raw,
        };
        setBeadsInstance(mockBeads as any);

        const service = getInstructionService();
        const instructions = await service.buildPrompt({
            role: 'worker',
            beadId: 'test-bead'
        }, "Base prompt");

        expect(instructions).not.toContain('# CONTEXT RESOURCES');
    });
});
