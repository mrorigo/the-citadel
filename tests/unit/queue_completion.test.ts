
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { WorkQueue } from '../../src/core/queue';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = '.citadel/test_queue_completion.sqlite';

describe('WorkQueue Completion Persistence', () => {
    let queue: WorkQueue;

    beforeEach(() => {
        if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
        queue = new WorkQueue(DB_PATH);
    });

    afterAll(() => {
        if (queue) queue.close();
        if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    });

    it('should preserve existing output if completed with undefined', () => {
        // 1. Create ticket
        queue.enqueue('bead-1', 1, 'worker');
        const ticket = queue.claim('agent-1', 'worker');
        expect(ticket).not.toBeNull();

        if (!ticket) return;

        // 2. Submit initial output (Simulating WorkerAgent)
        const initialPayload = { summary: 'Initial Work', data: 123 };
        queue.complete(ticket.id, initialPayload);

        // Verify initial state
        let result = queue.getOutput('bead-1');
        expect(result).toEqual(initialPayload);

        // 3. Complete again with undefined (Simulating Hook cleanup)
        // Note: complete() updates status to 'completed' again, which is fine
        queue.complete(ticket.id, undefined);

        // 4. Verify output is NOT overwritten with null
        result = queue.getOutput('bead-1');
        expect(result).toEqual(initialPayload);
    });

    it('should not overwrite output if already completed', () => {
        // 1. Create ticket
        queue.enqueue('bead-2', 1, 'worker');
        const ticket = queue.claim('agent-2', 'worker');
        if (!ticket) return;

        // 2. Submit initial output
        const initialPayload = { summary: 'A' };
        queue.complete(ticket.id, initialPayload);

        // 3. Complete with NEW output (should be ignored)
        const newPayload = { summary: 'B' };
        queue.complete(ticket.id, newPayload);

        // 4. Verify update - SHOULD remain 'A' (idempotent)
        const result = queue.getOutput('bead-2');
        expect(result).toEqual(initialPayload);
    });
});
