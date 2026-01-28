import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { WorkerAgent } from '../../src/agents/worker';
import { loadConfig } from '../../src/config';

describe('Tool Parameter Tolerance', () => {
    let agent: WorkerAgent;

    beforeAll(async () => {
        await loadConfig();
    });

    beforeEach(() => {
        agent = new WorkerAgent();
    });

    describe('run_command tolerance', () => {
        it('should accept "command" parameter (standard)', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({ command: 'echo hello' });

            expect(result.success).toBe(true);
            expect(result.stdout).toContain('hello');
        });

        it('should accept "cmd" parameter as string', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({ cmd: 'echo world' });

            expect(result.success).toBe(true);
            expect(result.stdout).toContain('world');
        });

        it('should accept "cmd" parameter as array and join with spaces', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({ cmd: ['echo', 'foo', 'bar'] });

            expect(result.success).toBe(true);
            expect(result.stdout).toContain('foo bar');
        });

        it('should fail if neither command nor cmd is provided', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({});

            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
        });

        it('should prefer "command" over "cmd" if both provided', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({
                command: 'echo priority',
                cmd: 'echo ignored'
            });

            expect(result.success).toBe(true);
            expect(result.stdout).toContain('priority');
            expect(result.stdout).not.toContain('ignored');
        });

        it('should accept extra parameters like timeout (passthrough)', async () => {
            const tool = (agent as any).tools['run_command'];
            const result = await tool.execute({
                cmd: 'echo test',
                timeout: 100000,
                someOtherParam: 'ignored'
            });

            expect(result.success).toBe(true);
            expect(result.stdout).toContain('test');
        });
    });
});
