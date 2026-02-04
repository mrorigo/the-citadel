import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Hook } from '../../src/core/hooks';
import { WorkQueue } from '../../src/core/queue';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DB_HOOKS = join(process.cwd(), 'tests/temp_hooks.sqlite');

describe('Hook Mechanism Integration', () => {
    let queue: WorkQueue;
    let hook: Hook;

    beforeEach(async () => {
        await rm(TEST_DB_HOOKS, { force: true });
        queue = new WorkQueue(TEST_DB_HOOKS);
    });

    afterEach(async () => {
        if (hook) hook.stop();
        if (queue) queue.close();
        await rm(TEST_DB_HOOKS, { force: true });
    });

    it('should poll and execute tasks', async () => {
        queue.enqueue('bead-hook-1', 0, 'worker');

        let executedBeadId: string | null = null;

        hook = new Hook('agent-tester', 'worker', async (ticket) => {
            executedBeadId = ticket.bead_id;
        }, queue);

        // Reduce polling interval for test speed
        // biome-ignore lint/suspicious/noExplicitAny: Access private property
        (hook as any).pollingInterval = 50;

        hook.start();

        // Wait for execution
        const start = Date.now();
        while (!executedBeadId && Date.now() - start < 1000) {
            await new Promise(r => setTimeout(r, 50));
        }

        expect(executedBeadId as unknown as string).toBe('bead-hook-1');

        // Verify completion in queue
        // We need to wait a moment for the hook to finish calling complete() after handler returns
        await new Promise(r => setTimeout(r, 100)); // Give it time to finalize

        // biome-ignore lint/suspicious/noExplicitAny: Access private property
        const db = (queue as any).db;
        const ticket = db.query('SELECT * FROM tickets WHERE bead_id = ?').get('bead-hook-1');
        expect(ticket.status).toBe('completed');
    });
});
