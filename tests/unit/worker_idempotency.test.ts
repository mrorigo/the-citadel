
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
import { setBeadsInstance, type BeadsClient, type Bead } from '../../src/core/beads';
import { setQueueInstance, type WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry, type FormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import type { LanguageModel } from 'ai';
import type { CoreTool } from '../../src/core/tool';

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
    let mockBeads: Partial<BeadsClient>;
    let mockQueue: Partial<WorkQueue>;

    afterAll(() => {
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');

        mockBeads = {
            update: mock(async () => ({})),
            get: mock(async () => ({ id: 'test-bead', status: 'verify', title: 'test', created_at: '', updated_at: '' })),
            ready: mock(async () => [])
        } as unknown as Partial<BeadsClient>;

        mockQueue = {
            getActiveTicket: mock(() => null), // Default: Ticket is GONE (closed)
            complete: mock(() => ({})),
            getOutput: mock(() => null)
        } as unknown as Partial<WorkQueue>;

        setBeadsInstance(mockBeads as BeadsClient);
        setQueueInstance(mockQueue as WorkQueue);
        setFormulaRegistry({ get: () => null } as unknown as FormulaRegistry);

        agent = new WorkerAgent(mockModel);
    });

    it('should handle Double Submit gracefully (Scenario A: Already Verified)', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        // Scenario A: Ticket is null, Bead status is ALREADY 'verify'
        mockBeads.get = mock(async () => ({
            id: 'test-bead',
            status: 'verify',
            title: '',
            created_at: '',
            updated_at: '',
            priority: 1
        } as unknown as Bead));

        const result = await submitWork.execute({
            summary: 'Retry summary'
        }, { toolCallId: 'call-1', messages: [], beadId: 'test-bead' } as any);

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).message).toContain('already submitted');
    });

    it('should RECOVER from partial failure (Scenario B: Ticket closed, Bead not updated)', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        // Scenario B:
        // 1. Ticket is GONE (ActiveTicket = null)
        // 2. Bead is STILL in_progress (Update failed previously)
        // 3. Output EXISTS in queue (Complete succeeded)

        mockBeads.get = mock(async () => ({
            id: 'stuck-bead',
            status: 'in_progress',
            title: '',
            created_at: '',
            updated_at: '',
            priority: 1
        } as unknown as Bead));
        mockQueue.getActiveTicket = mock(() => null);
        mockQueue.getOutput = mock(() => ({ summary: 'Persisted Summary' })); // Output found!

        const result = await submitWork.execute({
            summary: 'Retry summary'
        }, { toolCallId: 'call-1', messages: [], beadId: 'stuck-bead' } as any);

        // Verify:
        // 1. Should return success
        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).status).toBe('verify');
        expect((result as Record<string, unknown>).message).toContain('recovered');

        // 2. Should have triggered a forced UPDATE to verify
        // @ts-expect-error
        expect(mockBeads.update).toHaveBeenCalled();
        // @ts-expect-error
        expect(mockBeads.update.mock.lastCall[1]).toEqual({ status: 'verify' });
    });
});
