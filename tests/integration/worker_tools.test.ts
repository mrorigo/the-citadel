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

    it('should have new tools registered', () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const tools = (agent as any).tools;
        expect(tools).toHaveProperty('read_file');
        expect(tools).toHaveProperty('write_file');
        expect(tools).toHaveProperty('list_dir');
        expect(tools).toHaveProperty('run_command');
    });

    it('should write and read a file', async () => {
        const filePath = join(TEST_DIR, 'test.txt');
        const content = 'Hello Worker';

        // Write
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const writeTool = (agent as any).tools.write_file;
        const writeResult = await writeTool.execute({ path: filePath, content });
        expect(writeResult.success).toBe(true);
        expect(writeResult.path).toBe(filePath);

        // Read
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const readTool = (agent as any).tools.read_file;
        const readResult = await readTool.execute({ path: filePath });
        expect(readResult.success).toBe(true);
        expect(readResult.content).toBe(content);
    });

    it('should list directory contents', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const listTool = (agent as any).tools.list_dir;
        const result = await listTool.execute({ path: TEST_DIR });

        expect(result.success).toBe(true);
        expect(result.items).toBeArray();
        // biome-ignore lint/suspicious/noExplicitAny: Test assertion
        expect(result.items.some((i: any) => i.name === 'test.txt')).toBe(true);
    });

    it('should run a shell command', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const cmdTool = (agent as any).tools.run_command;
        const result = await cmdTool.execute({ command: 'echo "hello shell"' });

        expect(result.success).toBe(true);
        expect(result.stdout).toBe('hello shell');
    });

    it('should handle errors gracefully', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Accessing private property
        const readTool = (agent as any).tools.read_file;
        const result = await readTool.execute({ path: join(TEST_DIR, 'nonexistent.txt') });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});
