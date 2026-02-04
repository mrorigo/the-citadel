import { describe, it, expect, mock, beforeAll } from 'bun:test';

// Mock generateText to avoid calling real LLM
const mockModel = {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => ({
        content: [{ type: 'text', text: 'Mocked Result' }],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 }
    })
} as any;

import { loadConfig, resetConfig } from '../../src/config';

import { RouterAgent } from '../../src/agents/router';
import { WorkerAgent } from '../../src/agents/worker';

describe('Agents Unit Tests', () => {
    beforeAll(async () => {
        resetConfig();
        await loadConfig();
    });

    it('RouterAgent should have enqueue_task tool', async () => {
        const agent = new RouterAgent(mockModel);
        // Since we mocked tool() to return args, we can inspect 'tools'
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('enqueue_task');
        expect(tools.enqueue_task.description).toContain('Enqueue');
    });

    it('WorkerAgent should have report_progress and submit_work tools', async () => {
        const agent = new WorkerAgent(mockModel);
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
    });
});
