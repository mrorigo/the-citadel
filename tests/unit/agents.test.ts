import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { RouterAgent } from '../../src/agents/router';
import { WorkerAgent } from '../../src/agents/worker';

import { loadConfig } from '../../src/config';

// Mock generateText to avoid calling real LLM
mock.module('ai', () => ({
    generateText: mock(async () => ({ text: 'Mocked Plan' })),
    // biome-ignore lint/suspicious/noExplicitAny: Mocking tool arguments
    tool: (args: any) => args, // Return args as the tool for inspection
}));

describe('Agents Unit Tests', () => {
    beforeAll(async () => {
        await loadConfig();
    });

    it('RouterAgent should have enqueue_task tool', () => {
        const agent = new RouterAgent();
        // Since we mocked tool() to return args, we can inspect 'tools'
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('enqueue_task');
        expect(tools.enqueue_task.description).toContain('Enqueue');
    });

    it('WorkerAgent should have report_progress and submit_work tools', () => {
        const agent = new WorkerAgent();
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
    });
});
