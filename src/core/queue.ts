import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger";
import { getGlobalSingleton, setGlobalSingleton } from "./registry";

// --- Schema ---

export const TicketStatusSchema = z.enum([
	"queued",
	"processing",
	"completed",
	"failed",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketSchema = z.object({
	id: z.string(),
	pearl_id: z.string(),
	status: TicketStatusSchema,
	priority: z.number().min(0).max(3),
	target_role: z.enum(["worker", "gatekeeper"]),
	assignee_id: z.string().nullable(),
	created_at: z.number(),
	started_at: z.number().nullable(),
	completed_at: z.number().nullable(),
	heartbeat_at: z.number().nullable(),
	retry_count: z.number(),
	next_attempt_at: z.number().nullable(),
	output: z.unknown().optional(),
});

export type Ticket = z.infer<typeof TicketSchema>;

// --- Queue Implementation ---

export class WorkQueue {
	private db: Database;

	constructor(dbPath?: string) {
		const finalPath =
			dbPath || resolve(process.cwd(), ".citadel", "queue.sqlite");

		// Ensure directory exists
		mkdirSync(dirname(finalPath), { recursive: true });

		this.db = new Database(finalPath);
		this.init();
	}

	private init() {
		this.db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        pearl_id TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        target_role TEXT NOT NULL,
        assignee_id TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        heartbeat_at INTEGER,
        retry_count INTEGER DEFAULT 0,
        next_attempt_at INTEGER
      )
    `);

		// Indexes for speed
		this.db.run(
			`CREATE INDEX IF NOT EXISTS idx_status_priority ON tickets(status, priority ASC, created_at ASC)`,
		);
		this.db.run(`CREATE INDEX IF NOT EXISTS idx_pearl_id ON tickets(pearl_id)`);

		// Migration: Add output column if not exists
		try {
			this.db.run(`ALTER TABLE tickets ADD COLUMN output TEXT`);
		} catch {
			/* ignore */
		}

		try {
			this.db.run(`ALTER TABLE tickets ADD COLUMN next_attempt_at INTEGER`);
		} catch {
			/* ignore */
		}
	}

	enqueue(pearlId: string, priority?: number, targetRole?: string): void {
		const id = crypto.randomUUID();
		const now = Date.now();

		// Default to worker/priority 1 if mission
		const finalPriority = priority ?? 1;
		const finalRole = targetRole ?? "worker";

		this.db.run(
			`
      INSERT INTO tickets (id, pearl_id, status, priority, target_role, created_at, retry_count)
      VALUES (?, ?, 'queued', ?, ?, ?, 0)
    `,
			[id, pearlId, finalPriority, finalRole, now],
		);
	}

	/**
	 * Claim a ticket for processing (The Hook)
	 */
	claim(assigneeId: string, role: string): Ticket | null {
		// Atomic update to claim the highest priority, oldest ticket
		// Bun SQLite is synchronous, so we can do this in a transaction

		const transaction = this.db.transaction(() => {
			// Find candidate
			const now = Date.now();
			const candidate = this.db
				.query(`
            SELECT * FROM tickets 
            WHERE status = 'queued' AND target_role = ? 
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY priority ASC, created_at ASC 
            LIMIT 1
        `)
				.get(role, now) as Ticket | null;

			if (!candidate) return null;

			logger.info(`[Queue] Claiming ticket ${candidate.id} for ${assigneeId} (role: ${role})`);

			this.db.run(
				`
            UPDATE tickets 
            SET status = 'processing', assignee_id = ?, started_at = ?, heartbeat_at = ?
            WHERE id = ?
        `,
				[assigneeId, now, now, candidate.id],
			);

			// Return fresh record
			return this.db
				.query(`SELECT * FROM tickets WHERE id = ?`)
				.get(candidate.id) as Ticket;
		});

		return transaction();
	}

	/**
	 * Signal that the worker is still alive
	 */
	heartbeat(ticketId: string): void {
		this.db.run(
			`
        UPDATE tickets 
        SET heartbeat_at = ? 
        WHERE id = ? AND status = 'processing'
    `,
			[Date.now(), ticketId],
		);
	}

	/**
	 * Mark ticket as complete with optional output
	 */
	/**
	 * Mark ticket as complete with optional output
	 */
	complete(ticketId: string, output?: unknown): void {
		logger.info(`[Queue] Completing ticket ${ticketId}`);

		const now = Date.now();
		let result: { changes: number };

		if (output !== undefined && output !== null) {
			const outputJson = JSON.stringify(output);
			result = this.db.run(
				`
            UPDATE tickets 
            SET status = 'completed', completed_at = ?, output = ? 
            WHERE id = ? AND status = 'processing'
        `,
				[now, outputJson, ticketId],
			) as { changes: number };
		} else {
			// Preserve existing output
			result = this.db.run(
				`
            UPDATE tickets 
            SET status = 'completed', completed_at = ?
            WHERE id = ? AND status = 'processing'
        `,
				[now, ticketId],
			) as { changes: number };
		}

		if (result.changes === 0) {
			// Check if it was already completed (idempotency)
			const current = this.db
				.query(`SELECT status FROM tickets WHERE id = ?`)
				.get(ticketId) as { status: string } | null;
			
			if (current && current.status === "completed") {
				logger.debug(`[Queue] Ticket ${ticketId} already completed (idempotent).`);
				return;
			}

			const status = current?.status || "unknown";
			logger.warn(`[Queue] Failed to complete ticket ${ticketId}: Expected 'processing', found '${status}'.`);
			
			throw new Error(
				`Failed to complete ticket ${ticketId}: Ticket is not in 'processing' state (current: ${status}).`,
			);
		}
	}

	/**
	 * Get output of a completed ticket by Pearl ID
	 */
	getOutput(pearlId: string): unknown {
		const result = this.db
			.query(`
            SELECT output FROM tickets 
            WHERE pearl_id = ? AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        `)
			.get(pearlId) as { output: string | null } | null;

		if (result?.output) {
			return JSON.parse(result.output);
		}
		return null;
	}

	/**
	 * Release a failed ticket back to queue (or fail permanently)
	 */
	fail(
		ticketId: string,
		permanent: boolean = false,
		maxRetries: number = 10,
	): void {
		if (permanent) {
			this.db.run(
				`
            UPDATE tickets 
            SET status = 'failed' 
            WHERE id = ? AND status = 'processing'
        `,
				[ticketId],
			);
		} else {
			// Re-queue with incremented retry count AND next_attempt_at
			const now = Date.now();
			const current = this.db
				.query(`SELECT retry_count FROM tickets WHERE id = ?`)
				.get(ticketId) as { retry_count: number };
			const nextRetry = (current?.retry_count || 0) + 1;

			if (nextRetry > maxRetries) {
				logger.warn(
					`[Queue] Ticket ${ticketId} exceeded max retries (${maxRetries}). Failing permanently.`,
				);
				this.db.run(
					`
                    UPDATE tickets 
                    SET status = 'failed' 
                    WHERE id = ? AND status = 'processing'
                `,
					[ticketId],
				);
				return;
			}

			// Exponential delay
			const nextAttempt = now + Math.min(1000 * 2 ** nextRetry, 300000);

			logger.info(`[Queue] Failing ticket ${ticketId} (retry ${nextRetry}/${maxRetries}, next attempt at ${new Date(nextAttempt).toISOString()})`);

			this.db.run(
				`
            UPDATE tickets 
            SET status = 'queued', assignee_id = NULL, started_at = NULL, heartbeat_at = NULL, 
                retry_count = ?, next_attempt_at = ?
            WHERE id = ? AND status = 'processing'
        `,
				[nextRetry, nextAttempt, ticketId],
			);
		}
	}

	/**
	 * Find stalled tickets and release them
	 */
	releaseStalled(timeoutMs: number): number {
		const cutoff = Date.now() - timeoutMs;
		const stalled = this.db
			.query(`
        SELECT id FROM tickets 
        WHERE status = 'processing' AND heartbeat_at < ?
    `)
			.all(cutoff) as { id: string }[];

		if (stalled.length === 0) return 0;

		const releaseStmt = this.db.prepare(`
        UPDATE tickets 
        SET status = 'queued', assignee_id = NULL, started_at = NULL, heartbeat_at = NULL, 
            retry_count = retry_count + 1, next_attempt_at = ?
        WHERE id = ?
    `);

		const transaction = this.db.transaction(() => {
			const now = Date.now();
			for (const ticket of stalled) {
				// For stalled, we might want a simpler backoff or use count
				const t = this.db
					.query(`SELECT retry_count FROM tickets WHERE id = ?`)
					.get(ticket.id) as { retry_count: number };
				const nextRetry = (t?.retry_count || 0) + 1;
				const nextAttempt = now + Math.min(1000 * 2 ** nextRetry, 300000);
				releaseStmt.run(nextAttempt, ticket.id);
			}
		});

		transaction();
		return stalled.length;
	}

	/**
	 * Check if a pearl has an active ticket (queued or processing)
	 */
	getActiveTicket(pearlId: string): Ticket | null {
		return this.db
			.query(`
            SELECT * FROM tickets 
            WHERE pearl_id = ? AND status IN ('queued', 'processing')
        `)
			.get(pearlId) as Ticket | null;
	}

	/**
	 * Get the latest ticket for a pearl (regardless of status)
	 */
	getLatestTicket(pearlId: string): Ticket | null {
		return this.db
			.query(`
            SELECT * FROM tickets 
            WHERE pearl_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `)
			.get(pearlId) as Ticket | null;
	}

	/**
	 * Reset tickets for a specific pearl
	 */
	resetPearl(pearlId: string): void {
		this.db.run("DELETE FROM tickets WHERE pearl_id = ?", [pearlId]);
	}

	/**
	 * Get tickets currently being processed
	 */
	listActive(timeoutMs?: number): Ticket[] {
		if (timeoutMs) {
			const cutoff = Date.now() - timeoutMs;
			return this.db
				.query("SELECT * FROM tickets WHERE status = 'processing' AND heartbeat_at > ?")
				.all(cutoff) as Ticket[];
		}
		return this.db
			.query("SELECT * FROM tickets WHERE status = 'processing'")
			.all() as Ticket[];
	}

	/**
	 * Get tickets by status
	 */
	getTicketsByStatus(status: TicketStatus): Ticket[] {
		return this.db
			.query("SELECT * FROM tickets WHERE status = ?")
			.all(status) as Ticket[];
	}

	/**
	 * Get all tickets, optionally filtered by status
	 */
	getAllTickets(status?: TicketStatus): Ticket[] {
		if (status) {
			return this.db
				.query("SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC")
				.all(status) as Ticket[];
		}
		return this.db
			.query("SELECT * FROM tickets ORDER BY created_at DESC")
			.all() as Ticket[];
	}

	/**
	 * Get count of pending (queued) tickets for a specific role
	 */
	getPendingCount(role: string): number {
		const result = this.db
			.query(`
            SELECT COUNT(*) as count 
            FROM tickets 
            WHERE status = 'queued' AND target_role = ?
        `)
			.get(role) as { count: number };
		return result.count;
	}
	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close();
	}
}

// Singleton accessor (defaulting to .citadel/queue.sqlite)
const QUEUE_KEY = "work_queue";
export function getQueue(): WorkQueue {
	return getGlobalSingleton(QUEUE_KEY, () => new WorkQueue());
}

export function setQueueInstance(queue: WorkQueue) {
	setGlobalSingleton(QUEUE_KEY, queue);
}
