import { describe, it, expect, mock, beforeAll } from 'bun:test';

// Mock generateText to avoid calling real LLM
mock.module('ai', () => ({
    generateText: mock(async () => ({ text: 'Mocked Plan' })),
    jsonSchema: (schema: any) => schema,
    // biome-ignore lint/suspicious/noExplicitAny: Mocking tool arguments
    tool: (args: any) => args, // Return args as the tool for inspection
}));

import { loadConfig, resetConfig } from '../../src/config';

describe('Agents Unit Tests', () => {
    beforeAll(async () => {
        resetConfig();
        await loadConfig();
    });

    it('RouterAgent should have enqueue_task tool', async () => {
        // Cache-busting hack to bypass mocks from other tests
        const { RouterAgent } = await import(`../../src/agents/router?t=${Date.now()}`);
        const agent = new RouterAgent();
        // Since we mocked tool() to return args, we can inspect 'tools'
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('enqueue_task');
        expect(tools.enqueue_task.description).toContain('Enqueue');
    });

    it('WorkerAgent should have report_progress and submit_work tools', async () => {
        const { WorkerAgent } = await import(`../../src/agents/worker?t=${Date.now()}`);
        const agent = new WorkerAgent();
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
    });
});
