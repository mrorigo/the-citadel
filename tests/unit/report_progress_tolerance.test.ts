import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { WorkerAgent } from '../../src/agents/worker';
import { loadConfig } from '../../src/config';
import { setPearlsInstance } from '../../src/core/pearls';
import { clearGlobalSingleton } from '../../src/core/registry';

describe('Report Progress Tolerance', () => {
    let mockPearls: any;

    beforeAll(async () => {
        await loadConfig();
        mockPearls = {
            update: mock(async () => ({ success: true })),
            get: mock(async () => ({ id: 'test-123', labels: [] })),
            create: mock(async () => ({ id: 'new-pearl' })),
            addDependency: mock(async () => ({ success: true })),
            addComment: mock(async () => ({ success: true })),
        };
        setPearlsInstance(mockPearls);
    });

    afterAll(() => {
        clearGlobalSingleton('pearls_client');
    });

    it('should work with exact message', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({ message: 'Starting...' }, { toolCallId: 'call-1', messages: [], pearlId: 'test-123' } as any);
        expect(result.success).toBe(true);
        expect(result.message).toContain('Starting...');
    });

    it('should fallback to reasoning if message is missing', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({ reasoning: 'Thinking about code...' }, { toolCallId: 'call-2', messages: [], pearlId: 'test-123' } as any);
        expect(result.success).toBe(true);
        expect(result.message).toContain('Thinking about code...');
    });

    it('should use default message if both are missing', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({}, { toolCallId: 'call-3', messages: [], pearlId: 'test-123' } as any);
        expect(result.success).toBe(true);
        expect(result.message).toContain('Working on it...');
    });

    it('should be tolerant of extra parameters', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({
            message: 'Done',
            extra: 'something',
            metadata: { foo: 'bar' }
        }, { toolCallId: 'call-4', messages: [], pearlId: 'test-123' } as any);
        expect(result.success).toBe(true);
        expect(result.message).toContain('Done');
    });
});
