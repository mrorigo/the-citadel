import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';

// Mock MCP Service moved to beforeEach via registry

import { WorkerAgent } from '../../src/agents/worker';
import { setPearlsInstance } from '../../src/core/pearls';
import { setQueueInstance } from '../../src/core/queue';
import { setFormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { z } from 'zod';
import { loadConfig, resetConfig } from '../../src/config';

// Mock LanguageModel
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

describe('WorkerAgent Integration Coverage', () => {
    let agent: WorkerAgent;
    let mockPearls: any;
    let mockQueue: any;
    let mockRegistry: any;

    // Use afterAll to clean up compilation level mocks
    afterAll(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
        clearGlobalSingleton('mcp_service');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        const { setGlobalSingleton } = require('../../src/core/registry');
        setGlobalSingleton('mcp_service', {
            getToolsForAgent: async () => ([]),
            initialize: async () => { },
            shutdown: async () => { },
            readResource: async () => ([]),
            callTool: async () => ({}),
            listResources: async () => ([])
        });
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');

        mockPearls = {
            update: mock(async () => ({})),
            create: mock(async () => ({ id: 'new-pearl' })),
            addDependency: mock(async () => ({})),
            get: mock(async () => ({ id: 'test-pearl', labels: ['formula:test', 'step:prep'] })),
            ready: mock(async () => [])
        };

        mockQueue = {
            getActiveTicket: mock(() => ({ id: 'ticket-1' })),
            complete: mock(() => ({})),
            enqueue: mock(() => ({}))
        };

        mockRegistry = {
            get: mock(() => ({
                steps: [{ id: 'prep', output_schema: { type: 'object', properties: { foo: { type: 'string' } } } }]
            }))
        };

        setPearlsInstance(mockPearls);
        setQueueInstance(mockQueue);
        setFormulaRegistry(mockRegistry);

        agent = new WorkerAgent(mockModel);
    });

    afterEach(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
    });

    it('should report progress', async () => {
        const reportProgress = (agent as any).tools['report_progress'];
        const result = await reportProgress.execute({ message: 'Working' }, { toolCallId: 'call-1', messages: [], pearlId: 'b1' } as any);

        expect(result.success).toBe(true);
        expect(mockPearls.update).toHaveBeenCalledWith('b1', { status: 'in_progress' });
    });

    it('should delegate tasks', async () => {
        const delegateTask = (agent as any).tools['delegate_task'];
        const result = await delegateTask.execute({ parentPearlId: 'p1', title: 'Subtask' }, { toolCallId: 'call-2', messages: [], pearlId: 'p1' } as any);

        if (!result.success) console.error('Delegate failure:', result);
        expect(result.success).toBe(true);
        expect(mockPearls.create).toHaveBeenCalled();
        expect(mockPearls.addDependency).toHaveBeenCalledWith('p1', 'new-pearl');
    });

    it('should handle delegation errors', async () => {
        mockPearls.create.mockImplementationOnce(() => { throw new Error('Create failed'); });
        const delegateTask = (agent as any).tools['delegate_task'];
        const result = await delegateTask.execute({ parentPearlId: 'p1', title: 'Subtask' }, { toolCallId: 'call-3', messages: [], pearlId: 'p1' } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to delegate: Create failed');
    });

    it('should run commands successfully', async () => {
        const runCommand = (agent as any).tools['run_command'];
        const result = await runCommand.execute({ command: 'echo "Success"' });

        expect(result.success).toBe(true);
        expect(result.stdout).toBe('Success');
    });

    it('should handle command errors', async () => {
        const runCommand = (agent as any).tools['run_command'];
        // Run a command that definitely doesn't exist to trigger the catch block
        const result = await runCommand.execute({ command: 'non_existent_command_12345' });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('should handle handleSubmitWork when ticket exists', async () => {
        const submitWork = (agent as any).tools['submit_work'];
        const result = await submitWork.execute({ summary: 'Done', output: { foo: 'bar' } }, { toolCallId: 'call-4', messages: [], pearlId: 'b1' } as any);

        expect(result.success).toBe(true);
        expect(mockPearls.update).toHaveBeenCalledWith('b1', { status: 'verify' });
        expect(mockQueue.complete).toHaveBeenCalledWith('ticket-1', { foo: 'bar' });
    });

    it('should handle handleSubmitWork when ticket is missing', async () => {
        mockQueue.getActiveTicket.mockReturnValue(null);
        const submitWork = (agent as any).tools['submit_work'];

        // Now throws an error instead of silently failing
        await expect(submitWork.execute({ summary: 'Done' }, { toolCallId: 'call-5', messages: [], pearlId: 'b1' } as any))
            .rejects.toThrow('No active ticket found for b1');
        expect(mockQueue.complete).not.toHaveBeenCalled();
    });

    it('should accept structured object output (planning workflow)', async () => {
        const submitWork = (agent as any).tools['submit_work'];
        const planOutput = {
            affected_files: ['README.md', 'src/feature.ts'],
            analysis: 'This plan addresses the feature request',
            steps: [
                { title: 'Step 1', description: 'Create files' },
                { title: 'Step 2', description: 'Implement logic' }
            ]
        };

        const result = await submitWork.execute({
            summary: 'Plan created',
            output: planOutput
        }, { toolCallId: 'call-6', messages: [], pearlId: 'b1' } as any);

        expect(result.success).toBe(true);
        expect(mockPearls.update).toHaveBeenCalledWith('b1', { status: 'verify' });
        expect(mockQueue.complete).toHaveBeenCalledWith('ticket-1', planOutput);
    });

    it('should apply dynamic schema in run()', async () => {
        await agent.run('test', { pearlId: 'test-pearl' });

        const submitWork = (agent as any).tools['submit_work'];
        const schema = submitWork.inputSchema as z.ZodObject<any>;
        const outputField = schema.shape.output;

        expect(outputField instanceof z.ZodOptional).toBe(true);
        const inner = (outputField as z.ZodOptional<any>).unwrap();
        // Now it's a union of string and object
        expect(inner instanceof z.ZodUnion).toBe(true);
    });

    it('should fallback to default schema when pearl/formula is missing', async () => {
        mockPearls.get.mockImplementationOnce(() => { throw new Error('Not found'); });
        await agent.run('test', { pearlId: 'missing' });

        const submitWork = (agent as any).tools['submit_work'];
        const outputField = (submitWork.inputSchema as any).shape.output;

        expect(outputField instanceof z.ZodOptional).toBe(true);
        // Default schema is union of string and string (since outputSchema defaults to z.string())
        expect(outputField.unwrap() instanceof z.ZodUnion).toBe(true);
    });

    it('should provide custom system prompt', () => {
        const prompt = (agent as any).getSystemPrompt('Default');
        expect(prompt).toContain('Default');
        expect(prompt).toContain('# Guidelines');
        expect(prompt).toContain('filesystem tools');
    });
});
