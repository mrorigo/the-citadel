
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock MCP Service FIRST
mock.module('../../src/services/mcp', () => ({
    getMCPService: () => ({
        getToolsForAgent: async () => ([]),
        initialize: async () => { },
        shutdown: async () => { }
    })
}));

import { CoreAgent } from '../../src/core/agent';
import { setBeadsInstance, type BeadsClient } from '../../src/core/beads';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import type { LanguageModel, ModelMessage } from 'ai';

// Concrete implementation of CoreAgent for testing
class TestAgent extends CoreAgent {
    constructor(model: LanguageModel, client?: BeadsClient) {
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
    let mockBeads: Partial<BeadsClient>;

    afterAll(() => {
        clearGlobalSingleton('beads_client');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('beads_client');

        mockBeads = {
            addComment: mock(async () => "comment-id"),
            // CoreAgent might call these if specific tools are used, but for basic run they shouldn't be needed unless we use tools
            // We'll keep it minimal
        } as unknown as Partial<BeadsClient>;

        // setBeadsInstance(mockBeads as BeadsClient); // No longer needed with DI, but consistent
        agent = new TestAgent(mockModel, mockBeads as BeadsClient);
    });

    it('should accumulate tokens and report to beads', async () => {
        const context = { beadId: 'test-bead-123' };

        // Run agent
        await agent.run("Test Prompt", context);

        // Check if addComment was called
        expect(mockBeads.addComment).toHaveBeenCalled();

        // Verify arguments
        const [beadId, comment] = (mockBeads.addComment as any).mock.calls[0];
        expect(beadId).toBe('test-bead-123');
        expect(comment).toContain('**Input Tokens**: 10');
        expect(comment).toContain('**Output Tokens**: 20');
        expect(comment).toContain('**Total Tokens**: 30');
    });

    it('should NOT report if beadId is missing', async () => {
        const context = {};

        await agent.run("Test Prompt", context);

        expect(mockBeads.addComment).not.toHaveBeenCalled();
    });
});
