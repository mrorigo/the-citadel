
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock MCP Service moved to beforeEach via registry

import { CoreAgent } from '../../src/core/agent';
import { setPearlsInstance, type PearlsClient } from '../../src/core/pearls';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import type { LanguageModel, ModelMessage } from 'ai';

// Concrete implementation of CoreAgent for testing
class TestAgent extends CoreAgent {
    constructor(model: LanguageModel, client?: PearlsClient) {
        super('worker', model, client); // Use 'worker' role as it exists in schema
    }

    // Override to bypass AI SDK and return controlled result
    protected async executeGenerateText(messages: ModelMessage[]): Promise<any> {
        return {
            text: 'Mocked Result',
            toolCalls: [],
            toolResults: [],
            finishReason: 'stop',
            usage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30
            }
        };
    }
}

const mockModel = {
    specificationVersion: 'v1',
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => ({})
} as unknown as LanguageModel;

describe('CoreAgent Token Usage Tracking', () => {
    let agent: TestAgent;
    let mockPearls: Partial<PearlsClient>;

    afterAll(() => {
        const { clearGlobalSingleton } = require('../../src/core/registry');
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('mcp_service');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        const { setGlobalSingleton } = require('../../src/core/registry');
        setGlobalSingleton('mcp_service', {
            getToolsForAgent: async () => ([]),
            initialize: async () => { },
            shutdown: async () => { },
            readResource: async () => ([]),
            callTool: async () => ({}),
            listResources: async () => ([])
        });
        clearGlobalSingleton('pearls_client');

        mockPearls = {
            addComment: mock(async () => "comment-id"),
            // CoreAgent might call these if specific tools are used, but for basic run they shouldn't be needed unless we use tools
            // We'll keep it minimal
        } as unknown as Partial<PearlsClient>;

        // setPearlsInstance(mockPearls as PearlsClient); // No longer needed with DI, but consistent
        agent = new TestAgent(mockModel, mockPearls as PearlsClient);
    });

    it('should accumulate tokens and report to pearls', async () => {
        const context = { pearlId: 'test-pearl-123' };

        // Run agent
        await agent.run("Test Prompt", context);

        // Check if addComment was called
        expect(mockPearls.addComment).toHaveBeenCalled();

        // Verify arguments
        const [pearlId, comment] = (mockPearls.addComment as any).mock.calls[0];
        expect(pearlId).toBe('test-pearl-123');
        expect(comment).toContain('**Input Tokens**: 10');
        expect(comment).toContain('**Output Tokens**: 20');
        expect(comment).toContain('**Total Tokens**: 30');
    });

    it('should NOT report if pearlId is missing', async () => {
        const context = {};

        await agent.run("Test Prompt", context);

        expect(mockPearls.addComment).not.toHaveBeenCalled();
    });
});
