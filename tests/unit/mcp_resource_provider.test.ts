import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { clearGlobalSingleton } from '../../src/core/registry';

// Mock dependencies
const mockGetConfig = mock(() => ({
    env: 'development',
    providers: { ollama: {} },
    agents: {
        worker: {
            provider: 'ollama',
            model: 'llama3',
            mcpResources: {
                server1: ['uri1']
            }
        },
        router: { provider: 'ollama', model: 'llama3' },
        gatekeeper: { provider: 'ollama', model: 'llama3' }
    },
    worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
    gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
    beads: { path: '.beads', binary: 'prl' }
}));

const getMockBead = () => ({
    labels: ['formula:test'],
    context: {
        mcp_resources: {
            server2: ['uri2']
        }
    }
});

const mockGetBeads = mock(() => {
    const bead = getMockBead();
    return {
        get: mock(async () => bead),
        update: mock(async () => bead),
        mapToDomain: (raw: any) => raw,
    };
});

const mockGetFormulaRegistry = mock(() => ({
    get: mock((name: string) => {
        if (name === 'test') {
            return {
                mcp_resources: {
                    server1: ['uri3']
                }
            };
        }
        return null;
    })
}));

const mockReadResource = mock(async (server: string, uri: string) => [`Content for ${server}:${uri}`]);
const mockGetMCPService = mock(() => ({
    readResource: mockReadResource
}));

// 2. Now import the code
import { MCPResourceProvider } from '../../src/core/mcp-resource-provider';
import { setBeadsInstance } from '../../src/core/beads';
import { setFormulaRegistry } from '../../src/core/formula';
import { setConfig, resetConfig } from '../../src/config';
import { setGlobalSingleton } from '../../src/core/registry';

describe('MCPResourceProvider', () => {
    beforeEach(() => {
        mockReadResource.mockClear();
        mockGetConfig.mockClear();
        setBeadsInstance(mockGetBeads() as any);
        setFormulaRegistry(mockGetFormulaRegistry() as any);
        setConfig(mockGetConfig() as any);
        setGlobalSingleton('mcp_service', mockGetMCPService());
        // Ensure instruction service is fresh
        clearGlobalSingleton('instruction_service');
    });

    afterEach(() => {
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('formula_registry');
        clearGlobalSingleton('mcp_service');
        clearGlobalSingleton('instruction_service');
        resetConfig();
    });

    it('should aggregate resources from all sources and fetch content', async () => {
        const provider = new MCPResourceProvider();
        const instructions = await provider.getInstructions({
            role: 'worker',
            beadId: 'bead-1'
        });

        expect(instructions).toContain('# CONTEXT RESOURCES');
        expect(instructions).toContain('## RESOURCE: server1:uri1');
        expect(instructions).toContain('Content for server1:uri1');
        expect(instructions).toContain('## RESOURCE: server1:uri3');
        expect(instructions).toContain('Content for server1:uri3');
        expect(instructions).toContain('## RESOURCE: server2:uri2');
        expect(instructions).toContain('Content for server2:uri2');

        // Verify MCPService was called for all unique resources
        expect(mockReadResource).toHaveBeenCalledWith('server1', 'uri1');
        expect(mockReadResource).toHaveBeenCalledWith('server1', 'uri3');
        expect(mockReadResource).toHaveBeenCalledWith('server2', 'uri2');
    });

    it('should return null if no resources are configured', async () => {
        // Temp override for this test
        const emptyConfig = {
            env: 'development',
            providers: { ollama: {} },
            agents: {
                worker: { provider: 'ollama', model: 'mock' },
                router: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            beads: { path: '.beads', binary: 'prl' }
        };
        mockGetConfig.mockReturnValue(emptyConfig as any);
        setConfig(emptyConfig as any);

        const bead = getMockBead();
        bead.labels = [];
        (bead as any).context = {};
        setBeadsInstance({
            get: mock(async () => bead),
            update: mock(async () => bead),
            mapToDomain: (raw: any) => raw,
        } as any);

        const provider = new MCPResourceProvider();
        const instructions = await provider.getInstructions({
            role: 'worker',
            beadId: 'bead-1'
        });

        expect(instructions).toBeNull();
    });
});
