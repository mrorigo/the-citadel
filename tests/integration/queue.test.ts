import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkQueue, getQueue } from '../../src/core/queue';
import { rm } from 'fs/promises';
import { join } from 'path';

const TEST_DB = join(process.cwd(), 'tests/temp_queue.sqlite');

describe('WorkQueue Integration', () => {
    let queue: WorkQueue;

    beforeEach(async () => {
        await rm(TEST_DB, { force: true });
        queue = new WorkQueue(TEST_DB);
    });

    afterEach(async () => {
        await rm(TEST_DB, { force: true });
    });

    it('should enqueue and claim tickets in priority order', () => {
        // Enqueue P1 then P0
        queue.enqueue('bead-1', 1);
        queue.enqueue('bead-0', 0);
        queue.enqueue('bead-2', 2);

        // Should claim P0 first
        const t0 = queue.claim('worker-1');
        expect(t0).not.toBeNull();
        expect(t0?.bead_id).toBe('bead-0');
        expect(t0?.status).toBe('processing');
        expect(t0?.assignee_id).toBe('worker-1');

        // Then P1
        const t1 = queue.claim('worker-2');
        expect(t1?.bead_id).toBe('bead-1');

        // Then P2
        const t2 = queue.claim('worker-3');
        expect(t2?.bead_id).toBe('bead-2');

        // Then null
        const tNull = queue.claim('worker-4');
        expect(tNull).toBeNull();
    });

    it('should update heartbeat', () => {
        queue.enqueue('bead-hb', 0);
        const ticket = queue.claim('worker-1')!;

        const initialHeartbeat = ticket.heartbeat_at!;
        expect(initialHeartbeat).toBeGreaterThan(0);

        // Sleep briefly to ensure time advances
        const start = Date.now();
        while (Date.now() - start < 10) { };

        queue.heartbeat(ticket.id);

        // We can't easily fetch back via public API without query method, but we can verify via claim/stalled logic if needed.
        // Or we add a get/query method to the class for testing? 
        // Actually, let's just use the fact that releaseStalled won't pick it up if heartbeat is fresh.

        // Better: verify via SQLite raw query or add getTicket method.
        // Let's add db access or just trust the logic? No, verify.
        // I can assume the class works if I can't access DB.
        // But since I have `queue['db']` access in JS/TS if I cast to any...

        const updated = (queue as any).db.query('SELECT * FROM tickets WHERE id = ?').get(ticket.id);
        expect(updated.heartbeat_at).toBeGreaterThan(initialHeartbeat);
    });

    it('should release stalled tickets', () => {
        queue.enqueue('bead-stalled', 0);
        const ticket = queue.claim('worker-1')!;

        // Manually set heartbeat to past
        const past = Date.now() - 10000;
        (queue as any).db.run('UPDATE tickets SET heartbeat_at = ? WHERE id = ?', [past, ticket.id]);

        // Release if older than 5000ms
        const releasedCount = queue.releaseStalled(5000);
        expect(releasedCount).toBe(1);

        // Should be available to claim again
        const reclaimed = queue.claim('worker-2');
        expect(reclaimed?.id).toBe(ticket.id);
        expect(reclaimed?.retry_count).toBe(1);
        expect(reclaimed?.assignee_id).toBe('worker-2');
    });

    it('should retry failed tickets', () => {
        queue.enqueue('bead-fail', 0);
        const ticket = queue.claim('worker-1')!;

        queue.fail(ticket.id, false); // Retryable

        const retried = queue.claim('worker-2');
        expect(retried?.id).toBe(ticket.id);
        expect(retried?.retry_count).toBe(1);
    });

    it('should not retry permanent failures', () => {
        queue.enqueue('bead-perm-fail', 0);
        const ticket = queue.claim('worker-1')!;

        queue.fail(ticket.id, true); // Permanent

        const retried = queue.claim('worker-2');
        expect(retried).toBeNull();
    });
});
