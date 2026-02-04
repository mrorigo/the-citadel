
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkQueue } from '../../src/core/queue';
import { Hook } from '../../src/core/hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../src/core/logger';

describe('Worker Hook Integration (Zombie Verification)', () => {
    let queue: WorkQueue;
    let tempDir: string;

    beforeEach(() => {
        // Use file-based DB to be closer to reality, or memory
        queue = new WorkQueue(':memory:');
    });

    afterEach(() => {
        if (queue) queue.close();
    });

    it('should handle double completion (Worker + Hook) gracefully', async () => {
        // 1. Setup Ticket
        const beadId = 'bead-1';
        queue.enqueue(beadId, 1, 'worker');
        const ticket = queue.claim('agent-1', 'worker');
        expect(ticket).not.toBeNull();
        if (!ticket) return;

        // 2. Simulate Worker Agent Logic (Explicit Complete)
        // This mirrors WorkerAgent.handleSubmitWork
        queue.complete(ticket.id, { result: 'worker-output' });

        // Verify state: Completed
        let check = queue.getActiveTicket(beadId);
        expect(check).toBeNull(); // Should be null because it's completed

        // 3. Simulate Hook Logic (Implicit Complete after run)
        // Hook calls handler, then calls complete
        const hookOutput = { result: 'hook-output' };

        // This call happens AFTER worker already completed it
        queue.complete(ticket.id, hookOutput);

        // Verify state: Still Completed (not processing)
        check = queue.getActiveTicket(beadId);
        expect(check).toBeNull();

        // Verify output is what we expect (Worker output shouldn't be overwritten if logic prevents it?)
        // Actual logic: 'UPDATE ... AND status = processing'
        // So second complete should be IGNORED.
        const output = queue.getOutput(beadId);
        expect(output).toEqual({ result: 'worker-output' });
    });

    it('should NOT create zombie if Hook fails', async () => {
        // 1. Setup Ticket
        const beadId = 'bead-fail';
        queue.enqueue(beadId, 1, 'worker');

        // 2. Hook logic
        const hook = new Hook('agent-fail', 'worker', async (t) => {
            // Worker completes it
            queue.complete(t.id, { res: 'done' });

            // And then THROWs
            throw new Error('Agent Crash');
        }, queue);

        // Run cycle
        await hook['cycle']();

        // 3. Verify state
        // Ticket should be COMPLETED (because worker completed it)
        // Hook catch block -> queue.fail()
        // fail -> UPDATE ... WHERE status = 'processing'
        // Since status is 'completed', fail should DO NOTHING.

        const active = queue.getActiveTicket(beadId);
        expect(active).toBeNull(); // Should be null (Completed)

        const output = queue.getOutput(beadId);
        expect(output).toEqual({ res: 'done' });
    });

    it('should THROW error if status is not processing during complete (preventing zombie)', async () => {
        // 1. Setup Ticket
        const beadId = 'bead-zombie';
        queue.enqueue(beadId, 1, 'worker');
        const ticket = queue.claim('agent-z', 'worker');
        expect(ticket).not.toBeNull();
        if (!ticket) return;

        // 2. Simulate external reset (e.g. timeout/fail) changing status to 'queued'
        queue['db'].run(`UPDATE tickets SET status = 'queued' WHERE id = ?`, [ticket.id]);

        // 3. Worker tries to complete
        // Expect this to THROW now, protecting the system from silent failure
        expect(() => {
            queue.complete(ticket.id, { res: 'done' });
        }).toThrow(/Ticket is not in 'processing' state/);

        // 4. Verify state
        // Ticket is still 'queued' (as expected)
        const active = queue.getActiveTicket(beadId);
        expect(active).not.toBeNull();
        expect(active?.status).toBe('queued');

        // Note: The zombie existence is still "true" here in this unit test because we haven't run the Router logic.
        // But the key is that the Agent code would have crashed/stopped instead of continuing to update beads.
    });
});
