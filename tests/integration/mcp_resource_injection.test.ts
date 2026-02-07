import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { setGlobalSingleton, clearGlobalSingleton } from '../../src/core/registry';
import { getInstructionService } from '../../src/core/instruction';
import { setConfig, resetConfig } from '../../src/config';
import { setPearlsInstance } from '../../src/core/pearls';
import { setFormulaRegistry } from '../../src/core/formula';

// 1. Mock modules BEFORE importing the code that uses them
mock.module('@modelcontextprotocol/sdk/types.js', () => ({
    ReadResourceRequestSchema: {},
    ListResourcesRequestSchema: {},
    ListRootsRequestSchema: {}
}));

const getMockPearl = () => ({
    id: 'test-pearl',
    labels: ['formula:test-formula'],
    context: {
        mcp_resources: {
            'pearl-server': ['pearl://uri']
        }
    }
});

describe('MCP Resource Injection Integration', () => {
    beforeEach(() => {
        resetConfig();
        setGlobalSingleton('mcp_service', {
            readResource: mock(async (server: string, uri: string) => [`Injected content from ${server}:${uri}`]),
            initialize: mock(async () => { }),
            shutdown: mock(async () => { })
        });

        const mockPearls = {
            get: mock(async () => getMockPearl()),
            update: mock(async () => getMockPearl()),
            create: mock(async () => getMockPearl()),
            init: mock(async () => { }),
            mapToDomain: (raw: any) => raw,
        };
        setPearlsInstance(mockPearls as any);

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
            pearls: { path: '.pearls', binary: 'prl' }
        });
    });

    afterEach(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        clearGlobalSingleton('mcp_service');
        clearGlobalSingleton('instruction_service');
        resetConfig();
    });

    it('should aggregate resources from config, formula, and pearl context', async () => {
        const service = getInstructionService();
        const instructions = await service.buildPrompt({
            role: 'worker',
            pearlId: 'test-pearl'
        }, "Base prompt");

        expect(instructions).toContain('# CONTEXT RESOURCES');

        // From config
        expect(instructions).toContain('## RESOURCE: config-server:config://uri');
        expect(instructions).toContain('Injected content from config-server:config://uri');

        // From formula
        expect(instructions).toContain('## RESOURCE: formula-server:formula://uri');
        expect(instructions).toContain('Injected content from formula-server:formula://uri');

        // From pearl context
        expect(instructions).toContain('## RESOURCE: pearl-server:pearl://uri');
        expect(instructions).toContain('Injected content from pearl-server:pearl://uri');
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
            pearls: { path: '.pearls', binary: 'prl' }
        });

        const testPearl = getMockPearl();
        testPearl.labels = [];
        (testPearl.context as any) = {};

        // We need to update the mock to return OUR manipulated pearl for this test
        const mockPearls = {
            get: mock(async () => testPearl),
            update: mock(async () => testPearl),
            create: mock(async () => testPearl),
            init: mock(async () => { }),
            mapToDomain: (raw: any) => raw,
        };
        setPearlsInstance(mockPearls as any);

        const service = getInstructionService();
        const instructions = await service.buildPrompt({
            role: 'worker',
            pearlId: 'test-pearl'
        }, "Base prompt");

        expect(instructions).not.toContain('# CONTEXT RESOURCES');
    });
});
