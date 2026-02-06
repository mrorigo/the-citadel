import { describe, it, expect, mock } from 'bun:test';
import { MCPResourceProvider } from '../../src/core/mcp-resource-provider';

// Mock dependencies
const mockGetConfig = mock(() => ({
    agents: {
        worker: {
            mcpResources: {
                server1: ['uri1']
            }
        }
    }
}));

const mockBead = {
    labels: ['formula:test'],
    context: {
        mcp_resources: {
            server2: ['uri2']
        }
    }
};

const mockGetBeads = mock(() => ({
    get: mock(async () => mockBead)
}));

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

// Mock modules
mock.module('../../src/config', () => ({
    getConfig: mockGetConfig
}));

mock.module('../../src/core/beads', () => ({
    getBeads: mockGetBeads
}));

mock.module('../../src/core/formula', () => ({
    getFormulaRegistry: mockGetFormulaRegistry
}));

mock.module('../../src/services/mcp', () => ({
    getMCPService: mockGetMCPService
}));

describe('MCPResourceProvider', () => {
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
        mockGetConfig.mockReturnValue({ agents: { worker: {} } } as any);
        (mockBead as any).labels = [];
        (mockBead as any).context = {};

        const provider = new MCPResourceProvider();
        const instructions = await provider.getInstructions({
            role: 'worker',
            beadId: 'bead-1'
        });

        expect(instructions).toBeNull();
    });
});
