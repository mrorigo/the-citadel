
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock MCP Service FIRST
mock.module('../../src/services/mcp', () => ({
    getMCPService: () => ({
        getToolsForAgent: async () => ([]),
        initialize: async () => { },
        shutdown: async () => { }
    })
}));

import { WorkerAgent } from '../../src/agents/worker';
import { setPearlsInstance, type PearlsClient } from '../../src/core/pearls';
import { setQueueInstance, type WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry, type FormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import { z } from 'zod';
import type { LanguageModel } from 'ai';

const mockModel = {
    specificationVersion: 'v1',
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => ({
        content: [{ type: 'text', text: 'Mocked Result' }],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
        rawResponse: {}
    })
} as unknown as LanguageModel;

describe('WorkerAgent Summary Conflation Fix', () => {
    let agent: WorkerAgent;
    let mockPearls: Partial<PearlsClient>;
    let mockQueue: Partial<WorkQueue>;

    afterAll(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');

        mockPearls = {
            update: mock(async () => ({})),
            get: mock(async () => ({ id: 'test-pearl', status: 'open', title: 'test', created_at: '', updated_at: '' })),
            ready: mock(async () => []),
            addComment: mock(async () => "comment-id")
        } as unknown as Partial<PearlsClient>;

        mockQueue = {
            getActiveTicket: mock(() => ({ id: 'ticket-1' })),
            complete: mock(() => ({}))
        } as unknown as Partial<WorkQueue>;

        setPearlsInstance(mockPearls as PearlsClient);
        setQueueInstance(mockQueue as WorkQueue);
        setFormulaRegistry({ get: () => null } as unknown as FormulaRegistry);

        agent = new WorkerAgent(mockModel);
    });

    it('should successfully PARSE missing top-level summary (fix verified)', async () => {
        const submitWork = (agent as any).tools.submit_work;
        const schema = submitWork.inputSchema as z.ZodObject<z.ZodRawShape>;

        const input = {
            output: {
                summary: 'Nested Summary',
                steps: []
            }
        };

        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('should extract nested summary in handler', async () => {
        const submitWork = (agent as any).tools.submit_work;

        // Mock update to verify success
        const result = await submitWork.execute({
            output: {
                summary: 'Extracted Summary',
                data: 'test'
            }
        }, { toolCallId: 'call-1', messages: [], pearlId: 'b1' } as any);

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toBe('Extracted Summary');
        expect((result as Record<string, unknown>).message).toBe('Work submitted successfully.');
        expect(mockPearls.update).toHaveBeenCalledWith('b1', { status: 'verify' });
    });

    it('should extract summary from output.analysis', async () => {
        const submitWork = (agent as any).tools.submit_work;

        const result = await submitWork.execute({
            output: {
                analysis: 'This is the analysis',
                steps: []
            }
        }, { toolCallId: 'call-2', messages: [], pearlId: 'b2' } as any);

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toBe('This is the analysis');
    });

    it('should generate fallback summary for structured output', async () => {
        const submitWork = (agent as any).tools.submit_work;

        const result = await submitWork.execute({
            output: {
                key1: 'val1',
                key2: 'val2'
            }
        }, { toolCallId: 'call-3', messages: [], pearlId: 'b3' } as any);

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toContain('Completed work with structured output');
    });

    it('should still fail if no summary AND no meaningful output', async () => {
        const submitWork = (agent as any).tools.submit_work;

        try {
            await submitWork.execute({
                // Missing output entirely or empty object
                output: {}
            }, { toolCallId: 'call-4', messages: [], pearlId: 'b4' } as any);
            throw new Error('Should have failed');
        } catch (e: unknown) {
            expect((e as Error).message).toContain("Missing required field: 'summary'");
        }
    });
});
