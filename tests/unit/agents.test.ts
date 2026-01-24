import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { RouterAgent } from '../../src/agents/router';
import { WorkerAgent } from '../../src/agents/worker';
import * as ai from 'ai';

import { loadConfig } from '../../src/config';

// Mock generateText to avoid calling real LLM
mock.module('ai', () => ({
    generateText: mock(async () => ({ text: 'Mocked Plan' })),
    tool: (args: any) => args, // Return args as the tool for inspection
}));

describe('Agents Unit Tests', () => {
    beforeAll(async () => {
        await loadConfig();
    });

    it('RouterAgent should have enqueue_task tool', () => {
        const agent = new RouterAgent();
        // Since we mocked tool() to return args, we can inspect 'tools'
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('enqueue_task');
        expect(tools.enqueue_task.description).toContain('Enqueue');
    });

    it('WorkerAgent should have report_progress and submit_work tools', () => {
        const agent = new WorkerAgent();
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
    });
});
