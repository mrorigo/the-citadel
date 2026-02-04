import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { WorkerAgent } from '../../src/agents/worker';
import { loadConfig } from '../../src/config';
import { setBeadsInstance } from '../../src/core/beads';
import { clearGlobalSingleton } from '../../src/core/registry';

describe('Report Progress Tolerance', () => {
    let mockBeads: any;

    beforeAll(async () => {
        await loadConfig();
        mockBeads = {
            update: mock(async () => ({ success: true })),
            get: mock(async () => ({ id: 'test-123', labels: [] })),
            create: mock(async () => ({ id: 'new-bead' })),
            addDependency: mock(async () => ({ success: true })),
        };
        setBeadsInstance(mockBeads);
    });

    afterAll(() => {
        clearGlobalSingleton('beads_client');
    });

    it('should work with exact message', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({ beadId: 'test-123', message: 'Starting...' });
        expect(result.success).toBe(true);
        expect(result.message).toContain('Starting...');
    });

    it('should fallback to reasoning if message is missing', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({ beadId: 'test-123', reasoning: 'Thinking about code...' });
        expect(result.success).toBe(true);
        expect(result.message).toContain('Thinking about code...');
    });

    it('should use default message if both are missing', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({ beadId: 'test-123' });
        expect(result.success).toBe(true);
        expect(result.message).toContain('Working on it...');
    });

    it('should be tolerant of extra parameters', async () => {
        const agent = new WorkerAgent();
        const tool = (agent as any).tools['report_progress'];
        const result = await tool.execute({
            beadId: 'test-123',
            message: 'Done',
            extra: 'something',
            metadata: { foo: 'bar' }
        });
        expect(result.success).toBe(true);
        expect(result.message).toContain('Done');
    });
});
