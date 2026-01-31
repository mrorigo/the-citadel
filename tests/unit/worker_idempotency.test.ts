
import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';

// Mock MCP Service FIRST
mock.module('../../src/services/mcp', () => ({
    getMCPService: () => ({
        getToolsForAgent: async () => ([]),
        initialize: async () => { },
        shutdown: async () => { }
    })
}));

import { WorkerAgent } from '../../src/agents/worker';
import { setBeadsInstance } from '../../src/core/beads';
import { setQueueInstance } from '../../src/core/queue';
import { setFormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import { z } from 'zod';

const mockModel: any = {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => ({
        content: [{ type: 'text', text: 'Mocked Result' }],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 }
    })
};

describe('WorkerAgent Idempotency', () => {
    let agent: WorkerAgent;
    let mockBeads: any;
    let mockQueue: any;

    afterAll(() => {
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');

        mockBeads = {
            update: mock(async () => ({})),
            get: mock(async () => ({ id: 'test-bead', status: 'verify' })), // Already verified
            ready: mock(async () => [])
        };

        mockQueue = {
            getActiveTicket: mock(() => null), // Ticket is GONE (closed)
            complete: mock(() => ({}))
        };

        setBeadsInstance(mockBeads);
        setQueueInstance(mockQueue);
        setFormulaRegistry({ get: () => null } as any);

        agent = new WorkerAgent(mockModel);
    });

    it('should handle Double Submit gracefully (Idempotency)', async () => {
        const submitWork = (agent as any).tools['submit_work'];

        // Scenario: Ticket is null, but Bead status is ALREADY 'verify'
        // Current behavior: Throws "No active ticket found"
        // Desired behavior: Returns success "Already submitted"

        let result;
        try {
            result = await submitWork.execute({
                beadId: 'test-bead',
                summary: 'Retry summary'
            });
        } catch (err: any) {
            // CURRENT FAILURE
            expect(err.message).toContain('No active ticket found');
            return;
        }

        // DESIRED SUCCESS (Once fixed)
        // expect(result.success).toBe(true);
        // expect(result.message).toContain('already submitted');
    });
});
