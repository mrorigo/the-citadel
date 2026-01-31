
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
import { setBeadsInstance, type BeadsClient } from '../../src/core/beads';
import { setQueueInstance, type WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry, type FormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';
import type { z } from 'zod';
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

describe('WorkerAgent Summary Conflation Fix', () => {
    let agent: WorkerAgent;
    let mockBeads: Partial<BeadsClient>;
    let mockQueue: Partial<WorkQueue>;

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
            get: mock(async () => ({ id: 'test-bead', status: 'open', title: 'test', created_at: '', updated_at: '' })),
            ready: mock(async () => [])
        } as unknown as Partial<BeadsClient>;

        mockQueue = {
            getActiveTicket: mock(() => ({ id: 'ticket-1' })),
            complete: mock(() => ({}))
        } as unknown as Partial<WorkQueue>;

        setBeadsInstance(mockBeads as BeadsClient);
        setQueueInstance(mockQueue as WorkQueue);
        setFormulaRegistry({ get: () => null } as unknown as FormulaRegistry);

        agent = new WorkerAgent(mockModel);
    });

    it('should successfully PARSE missing top-level summary (fix verified)', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;
        // Re-fetch schema from tool definition map
        const schema = submitWork.parameters as z.ZodObject<z.ZodRawShape>;

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
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        // Mock update to verify success
        const result = await submitWork.execute({
            beadId: 'b1',
            output: {
                summary: 'Extracted Summary',
                data: 'test'
            }
        });

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toBe('Extracted Summary');
        expect((result as Record<string, unknown>).message).toBe('Work submitted successfully.');
        // @ts-expect-error
        expect(mockBeads.update).toHaveBeenCalledWith('b1', { status: 'verify' });
    });

    it('should extract summary from output.analysis', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        const result = await submitWork.execute({
            beadId: 'b2',
            output: {
                analysis: 'This is the analysis',
                steps: []
            }
        });

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toBe('This is the analysis');
    });

    it('should generate fallback summary for structured output', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        const result = await submitWork.execute({
            beadId: 'b3',
            output: {
                key1: 'val1',
                key2: 'val2'
            }
        });

        expect(result.success).toBe(true);
        expect((result as Record<string, unknown>).summary).toContain('Completed work with structured output');
    });

    it('should still fail if no summary AND no meaningful output', async () => {
        const submitWork = (agent as unknown as { tools: Record<string, CoreTool> }).tools.submit_work;

        try {
            await submitWork.execute({
                beadId: 'b4',
                // Missing output entirely or empty object
                output: {}
            });
            throw new Error('Should have failed');
        } catch (e: unknown) {
            expect((e as Error).message).toContain("Missing required field: 'summary'");
        }
    });
});
