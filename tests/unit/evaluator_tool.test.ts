
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { EvaluatorAgent } from '../../src/agents/evaluator';
import { loadConfig } from '../../src/config';
import { setBeadsInstance, type BeadsClient } from '../../src/core/beads';
import { clearGlobalSingleton } from '../../src/core/registry';

// Mock getBeads
const mockUpdate = mock(async () => ({}));
const mockBeads = {
    update: mockUpdate,
    get: mock(async () => ({ id: 'mock-id', title: 'mock', status: 'open', created_at: '', updated_at: '', priority: 2 })),
    create: mock(async () => ({ id: 'new-bead' })),
    addDependency: mock(async () => ({})),
} as unknown as BeadsClient;

describe('EvaluatorAgent Tool Schema', () => {
    let agent: EvaluatorAgent;

    afterAll(() => {
        clearGlobalSingleton('beads_client');
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        setBeadsInstance(mockBeads);
        agent = new EvaluatorAgent();
        mockUpdate.mockClear();
    });

    it('should handle string acceptance_test in approve_work', async () => {
        const tools = (agent as any).tools;
        const approveWork = tools['approve_work'];
        expect(approveWork).toBeDefined();

        await approveWork!.execute({
            beadId: 'bead-1',
            acceptance_test: 'Simple test criteria'
        });

        expect(mockUpdate).toHaveBeenCalledWith('bead-1', {
            status: 'done',
            acceptance_test: 'Simple test criteria'
        });
    });

    it('should handle array acceptance_test in approve_work', async () => {
        const tools = (agent as any).tools;
        const approveWork = tools['approve_work'];
        expect(approveWork).toBeDefined();

        await approveWork!.execute({
            beadId: 'bead-1',
            acceptance_test: ['Criteria 1', 'Criteria 2']
        });

        expect(mockUpdate).toHaveBeenCalledWith('bead-1', {
            status: 'done',
            acceptance_test: 'Criteria 1\nCriteria 2'
        });
    });

    it('should validate schema with string', () => {
        const schemas = (agent as any).schemas;
        const approveWorkSchema = schemas['approve_work'];
        const result = approveWorkSchema.safeParse({
            beadId: 'test',
            acceptance_test: 'foo'
        });
        expect(result.success).toBe(true);
    });

    it('should validate schema with array', () => {
        const schemas = (agent as any).schemas;
        const approveWorkSchema = schemas['approve_work'];
        const result = approveWorkSchema.safeParse({
            beadId: 'test',
            acceptance_test: ['one', 'two']
        });
        expect(result.success).toBe(true);
    });

    it('should validate run_command schema with string', () => {
        const schemas = (agent as any).schemas;
        const schema = schemas['run_command'];
        const result = schema.safeParse({
            command: 'echo test'
        });
        expect(result.success).toBe(true);
    });

    it('should validate run_command schema with cmd array', () => {
        const schemas = (agent as any).schemas;
        const schema = schemas['run_command'];
        const result = schema.safeParse({
            cmd: ['echo', 'test']
        });
        expect(result.success).toBe(true);
    });

    it('should normalize run_command args with cmd array', async () => {
        const tools = (agent as any).tools;
        const tool = tools['run_command'];

        // We can just run a safe command like 'echo' to verify it works (and proves normalization)
        const result = await tool.execute({
            cmd: ['echo', 'test_normalization']
        });

        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBe('test_normalization');
    });
});
