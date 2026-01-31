
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

describe('WorkerAgent Summary Conflation Fix', () => {
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
            get: mock(async () => ({ id: 'test-bead' })),
            ready: mock(async () => [])
        };

        mockQueue = {
            getActiveTicket: mock(() => ({ id: 'ticket-1' })),
            complete: mock(() => ({}))
        };

        setBeadsInstance(mockBeads);
        setQueueInstance(mockQueue);
        setFormulaRegistry({ get: () => null } as any);

        agent = new WorkerAgent(mockModel);
    });

    it('should successfully PARSE missing top-level summary (fix verified)', async () => {
        const submitWork = (agent as any).tools['submit_work'];
        // Re-fetch schema from tool definition map
        const schema = submitWork.parameters as z.ZodObject<any>;

        const input = {
            beadId: 'b1',
            output: {
                summary: 'Nested Summary',
                steps: []
            }
        };

        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('should extract nested summary in handler', async () => {
        const submitWork = (agent as any).tools['submit_work'];

        // Mock update to verify success
        const result = await submitWork.execute({
            beadId: 'b1',
            output: {
                summary: 'Extracted Summary',
                data: 'test'
            }
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Extracted Summary');
        expect(mockBeads.update).toHaveBeenCalledWith('b1', { status: 'verify' });
    });

    it('should still fail if summary is completely missing', async () => {
        const submitWork = (agent as any).tools['submit_work'];

        // Validation passes (because optional), but handler throws
        try {
            await submitWork.execute({
                beadId: 'b1',
                output: { data: 'no summary here' }
            });
            throw new Error('Should have failed');
        } catch (e: any) {
            expect(e.message).toContain('Missing required field: \'summary\'');
        }
    });
});
