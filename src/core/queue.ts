import { Database } from 'bun:sqlite';
import { z } from 'zod';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';


// --- Schema ---

export const TicketStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketSchema = z.object({
    id: z.string(),
    bead_id: z.string(),
    status: TicketStatusSchema,
    priority: z.number().min(0).max(3),
    target_role: z.enum(['router', 'worker', 'supervisor', 'gatekeeper']),
    assignee_id: z.string().nullable(),
    created_at: z.number(),
    started_at: z.number().nullable(),
    completed_at: z.number().nullable(),
    heartbeat_at: z.number().nullable(),
    retry_count: z.number(),
});

export type Ticket = z.infer<typeof TicketSchema>;

// --- Queue Implementation ---

export class WorkQueue {
    private db: Database;

    constructor(dbPath?: string) {
        const finalPath = dbPath || resolve(process.cwd(), '.citadel', 'queue.sqlite');

        // Ensure directory exists
        mkdirSync(dirname(finalPath), { recursive: true });

        this.db = new Database(finalPath);
        this.init();
    }

    private init() {
        this.db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        bead_id TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        target_role TEXT NOT NULL,
        assignee_id TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        heartbeat_at INTEGER,
        retry_count INTEGER DEFAULT 0
      )
    `);

        // Indexes for speed
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_status_priority ON tickets(status, priority ASC, created_at ASC)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_bead_id ON tickets(bead_id)`);
    }

    enqueue(beadId: string, priority: number, targetRole: string): void {
        const id = crypto.randomUUID();
        const now = Date.now();

        this.db.run(`
      INSERT INTO tickets (id, bead_id, status, priority, target_role, created_at, retry_count)
      VALUES (?, ?, 'queued', ?, ?, ?, 0)
    `, [id, beadId, priority, targetRole, now]);
    }

    /**
     * Claim a ticket for processing (The Hook)
     */
    claim(assigneeId: string, role: string): Ticket | null {
        // Atomic update to claim the highest priority, oldest ticket
        // Bun SQLite is synchronous, so we can do this in a transaction

        const transaction = this.db.transaction(() => {
            // Find candidate
            const candidate = this.db.query(`
            SELECT * FROM tickets 
            WHERE status = 'queued' AND target_role = ?
            ORDER BY priority ASC, created_at ASC 
            LIMIT 1
        `).get(role) as Ticket | null;

            if (!candidate) return null;

            const now = Date.now();
            this.db.run(`
            UPDATE tickets 
            SET status = 'processing', assignee_id = ?, started_at = ?, heartbeat_at = ?
            WHERE id = ?
        `, [assigneeId, now, now, candidate.id]);

            // Return fresh record
            return this.db.query(`SELECT * FROM tickets WHERE id = ?`).get(candidate.id) as Ticket;
        });

        return transaction();
    }

    /**
     * Signal that the worker is still alive
     */
    heartbeat(ticketId: string): void {
        this.db.run(`
        UPDATE tickets 
        SET heartbeat_at = ? 
        WHERE id = ? AND status = 'processing'
    `, [Date.now(), ticketId]);
    }

    /**
     * Mark ticket as complete
     */
    complete(ticketId: string): void {
        this.db.run(`
        UPDATE tickets 
        SET status = 'completed', completed_at = ? 
        WHERE id = ?
    `, [Date.now(), ticketId]);
    }

    /**
     * Release a failed ticket back to queue (or fail permanently)
     */
    fail(ticketId: string, permanent: boolean = false): void {
        if (permanent) {
            this.db.run(`
            UPDATE tickets 
            SET status = 'failed' 
            WHERE id = ?
        `, [ticketId]);
        } else {
            // Re-queue with incremented retry count
            this.db.run(`
            UPDATE tickets 
            SET status = 'queued', assignee_id = NULL, started_at = NULL, heartbeat_at = NULL, retry_count = retry_count + 1
            WHERE id = ?
        `, [ticketId]);
        }
    }

    /**
     * Find stalled tickets and release them
     */
    releaseStalled(timeoutMs: number): number {
        const cutoff = Date.now() - timeoutMs;
        const stalled = this.db.query(`
        SELECT id FROM tickets 
        WHERE status = 'processing' AND heartbeat_at < ?
    `).all(cutoff) as { id: string }[];

        if (stalled.length === 0) return 0;

        const releaseStmt = this.db.prepare(`
        UPDATE tickets 
        SET status = 'queued', assignee_id = NULL, started_at = NULL, heartbeat_at = NULL, retry_count = retry_count + 1
        WHERE id = ?
    `);

        const transaction = this.db.transaction(() => {
            for (const ticket of stalled) {
                releaseStmt.run(ticket.id);
            }
        });

        transaction();
        return stalled.length;
    }

    /**
     * Check if a bead has an active ticket (queued or processing)
     */
    getActiveTicket(beadId: string): Ticket | null {
        return this.db.query(`
            SELECT * FROM tickets 
            WHERE bead_id = ? AND status IN ('queued', 'processing')
        `).get(beadId) as Ticket | null;
    }

    /**
     * Reset tickets for a specific bead
     */
    resetBead(beadId: string): void {
        this.db.run("DELETE FROM tickets WHERE bead_id = ?", [beadId]);
    }

    /**
     * Get tickets by status
     */
    getTicketsByStatus(status: TicketStatus): Ticket[] {
        return this.db.query("SELECT * FROM tickets WHERE status = ?").all(status) as Ticket[];
    }
}

// Singleton accessor (defaulting to .citadel/queue.sqlite)
let _queue: WorkQueue | null = null;
export function getQueue(): WorkQueue {
    if (!_queue) _queue = new WorkQueue();
    return _queue;
}

export function setQueueInstance(queue: WorkQueue) {
    _queue = queue;
}
