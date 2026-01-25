import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WorkerAgent } from '../../src/agents/worker';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';


import { loadConfig } from '../../src/config';

const TEST_DIR = join(process.cwd(), 'tests/temp_worker_tools');

describe('WorkerAgent Tools', () => {
    let agent: WorkerAgent;

    beforeAll(async () => {
        await loadConfig();
        await rm(TEST_DIR, { recursive: true, force: true });
        await mkdir(TEST_DIR, { recursive: true });
        agent = new WorkerAgent();
        // Mock getBeads/getQueue access if needed? 
        // WorkerAgent constructor doesn't fail, but 'report_progress' touches beads.
        // We are testing new tools which don't touch beads.
    });

    afterAll(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it('should have native tools registered', () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('report_progress');
        expect(tools).toHaveProperty('submit_work');
        expect(tools).toHaveProperty('delegate_task');
        expect(tools).toHaveProperty('run_command');
    });

    it('should run a shell command', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const cmdTool = (agent as any).tools.run_command;
        const result = await cmdTool.execute({ command: 'echo "hello shell"' });

        expect(result.success).toBe(true);
        expect(result.stdout).toBe('hello shell');
    });
});
