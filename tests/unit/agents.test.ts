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

import { WorkerAgent } from '../../src/agents/worker';

describe('Agents Unit Tests', () => {

    it('WorkerAgent should have report_progress and submit_work tools', async () => {
        const agent = new WorkerAgent("worker", mockModel);
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
    });
});
