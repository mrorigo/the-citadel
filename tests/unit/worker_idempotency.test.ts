
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
import { setPearlsInstance, type PearlsClient, type Pearl } from '../../src/core/pearls';
import { setQueueInstance, type WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry, type FormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig, resetConfig } from '../../src/config';
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

describe('WorkerAgent Idempotency', () => {
    let agent: WorkerAgent;
    let mockPearls: Partial<PearlsClient>;
    let mockQueue: Partial<WorkQueue>;

    afterAll(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');

        mockPearls = {
            update: mock(async () => ({})),
            get: mock(async () => ({ id: 'test-pearl', status: 'verify', title: 'test', created_at: '', updated_at: '' })),
            ready: mock(async () => []),
            addComment: mock(async () => ({}))
        } as unknown as Partial<PearlsClient>;

        mockQueue = {
            getActiveTicket: mock(() => null), // Default: Ticket is GONE (closed)
            complete: mock(() => ({})),
            getOutput: mock(() => null)
        } as unknown as Partial<WorkQueue>;

        setPearlsInstance(mockPearls as PearlsClient);
        setQueueInstance(mockQueue as WorkQueue);
        setFormulaRegistry({ get: () => null } as unknown as FormulaRegistry);

        agent = new WorkerAgent("worker", mockModel);
    });

    it('should handle Double Submit gracefully (Scenario A: Already Verified)', async () => {
        const submitWork = (agent as any).tools.submit_work;

        // Scenario A: Ticket is null, Pearl status is ALREADY 'verify'
        mockPearls.get = mock(async () => ({
            id: 'test-pearl',
            status: 'verify',
            title: '',
            created_at: '',
            updated_at: '',
            priority: 1
        } as unknown as Pearl));

        const result = await submitWork.execute({
            summary: 'Retry summary'
        }, { toolCallId: 'call-1', messages: [], pearlId: 'test-pearl' } as any);

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).message).toContain('already submitted');
    });

    it('should RECOVER from partial failure (Scenario B: Ticket closed, Pearl not updated)', async () => {
        const submitWork = (agent as any).tools.submit_work;

        // Scenario B:
        // 1. Ticket is GONE (ActiveTicket = null)
        // 2. Pearl is STILL in_progress (Update failed previously)
        // 3. Output EXISTS in queue (Complete succeeded)

        mockPearls.get = mock(async () => ({
            id: 'stuck-pearl',
            status: 'in_progress',
            title: '',
            created_at: '',
            updated_at: '',
            priority: 1
        } as unknown as Pearl));
        mockQueue.getActiveTicket = mock(() => null);
        mockQueue.getOutput = mock(() => ({ summary: 'Persisted Summary' })); // Output found!

        const result = await submitWork.execute({
            summary: 'Retry summary'
        }, { toolCallId: 'call-1', messages: [], pearlId: 'stuck-pearl' } as any);

        // Verify:
        // 1. Should return success
        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).status).toBe('verify');
        expect((result as Record<string, unknown>).message).toContain('recovered');

        // 2. Should have triggered a forced UPDATE to verify
        // @ts-expect-error
        expect(mockPearls.update).toHaveBeenCalled();
        // @ts-expect-error
        expect(mockPearls.update.mock.lastCall[1]).toEqual({ status: 'verify' });
    });
});
