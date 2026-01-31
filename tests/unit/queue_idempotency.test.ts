import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkQueue } from '../../src/core/queue';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

describe('WorkQueue Idempotency', () => {
    const TEST_DB = join(process.cwd(), 'tests/temp_idempotency.sqlite');
    let queue: WorkQueue;

    beforeEach(async () => {
        queue = new WorkQueue(TEST_DB);
    });

    afterEach(async () => {
        await rm(TEST_DB, { force: true });
    });

    it('should NOT overwrite output if complete() is called twice', () => {
        const beadId = 'test-bead-1';
        queue.enqueue(beadId, 1, 'worker');

        const ticket = queue.claim('agent-1', 'worker');
        expect(ticket).not.toBeNull();
        if (!ticket) return;

        // First completion (simulating Tool call)
        const structuredOutput = { plan: 'Initial Plan' };
        queue.complete(ticket.id, structuredOutput);

        // Verify it was saved
        const result1 = queue.getOutput(beadId);
        expect(result1).toEqual(structuredOutput);

        // Second completion (simulating Hook finish with Narration string)
        const narrationString = 'I have finished my work.';
        queue.complete(ticket.id, narrationString);

        // Verify it was NOT overwritten
        const result2 = queue.getOutput(beadId);
        expect(result2).toEqual(structuredOutput);
        expect(result2).not.toEqual(narrationString);
    });

    it('should NOT re-queue if fail() is called after complete()', () => {
        const beadId = 'test-bead-2';
        queue.enqueue(beadId, 1, 'worker');

        const ticket = queue.claim('agent-2', 'worker');
        expect(ticket).not.toBeNull();
        if (!ticket) return;

        // Complete successfully
        queue.complete(ticket.id, 'Success');

        // Attempt to fail (simulating a crash at the very end of handler)
        queue.fail(ticket.id, false);

        // Verify it remains completed and NOT re-queued
        const ticketAfter = queue.getActiveTicket(beadId);
        expect(ticketAfter).toBeNull(); // No active ticket means it stayed completed or at least didn't go back to queued

        // Explicitly check status by querying if needed, but getActiveTicket(queued/processing) is enough
    });
});
