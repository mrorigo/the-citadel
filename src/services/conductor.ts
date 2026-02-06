import { EvaluatorAgent } from "../agents/evaluator";
import { RouterAgent } from "../agents/router";
import { WorkerAgent } from "../agents/worker";
import { getConfig } from "../config";
import type { CitadelConfig } from "../config/schema";
import { type BeadsClient, getBeads } from "../core/beads";
import { Hook } from "../core/hooks";
import { logger } from "../core/logger";
import { WorkerPool } from "../core/pool";
import { getQueue, type WorkQueue } from "../core/queue";
import { getMCPService } from "./mcp";
import { getPiper } from "./piper";

export class Conductor {
	private isRunning = false;
	private routerAgent = new RouterAgent();
	private routerTimer: Timer | null = null;
	private consecutiveFailures = 0;
	private config: CitadelConfig;

	// Pools
	private workerPool: WorkerPool;
	private gatekeeperPool: WorkerPool;

	private beads: BeadsClient;
	private queue: WorkQueue;

	constructor(
		beads?: BeadsClient,
		queue?: WorkQueue,
		config?: CitadelConfig,
		PoolClass: typeof WorkerPool = WorkerPool,
	) {
		this.beads = beads || getBeads();
		this.queue = queue || getQueue();
		this.config = config || getConfig();

		// Debug parallel test issue
		// @ts-expect-error
		logger.info(`[Conductor] Queue DB: ${this.queue.db?.filename}`);
		logger.info(
			`[Conductor] Config: min_workers=${this.config.worker.min_workers}`,
		);

		// Initialize Worker Pool
		// We use the injected PoolClass (defaulting to WorkerPool) to allow tests to override the implementation
		// while preserving the internal factory logic (which binds agent execution).
		this.workerPool = new PoolClass(
			"worker",
			(id: string) =>
				new Hook(
					id,
					"worker",
					async (ticket) => {
						logger.info(`[Worker] Processing ${ticket.bead_id}`, {
							beadId: ticket.bead_id,
						});

						// Move bead to in_progress when we start processing
						await this.beads.update(ticket.bead_id, { status: "in_progress" });

						const agent = new WorkerAgent();
						const bead = await this.beads.get(ticket.bead_id).catch(() => null);

						if (!bead) {
							logger.error(
								`[Worker] Failed to retrieve bead ${ticket.bead_id} for processing`,
								{ beadId: ticket.bead_id },
							);
							// We should fail the ticket if the bead is gone
							this.queue.fail(ticket.id, true);
							return;
						}

						try {
							const result = await agent.run(
								`Process this task: ${bead.title}`,
								{ beadId: ticket.bead_id, bead },
							);

							// Check if the bead was actually transitioned by the agent
							const finalBead = await this.beads.get(ticket.bead_id);

							if (finalBead.status === "in_progress") {
								// Agent exited without calling submit_work - this is a failure
								logger.warn(
									`[Worker] Agent exited without submitting work for ${ticket.bead_id}`,
									{ beadId: ticket.bead_id },
								);
								await this.beads.update(ticket.bead_id, {
									status: "open",
									labels: [...(finalBead.labels || []), "agent-incomplete"],
								});
							}
							return result;
						} catch (error) {
							// Agent crashed - mark as failed
							logger.error(
								`[Worker] Agent failed for ${ticket.bead_id}`,
								error,
							);
							const currentLabels = bead?.labels || [];
							await this.beads.update(ticket.bead_id, {
								status: "open",
								labels: [...currentLabels, "failed", "agent-error"],
							});
						}
					},
					this.queue,
					this.config.worker.maxRetries,
				),
			this.config.worker.min_workers,
		);

		// Initialize Gatekeeper Pool
		this.gatekeeperPool = new PoolClass(
			"gatekeeper",
			(id: string) =>
				new Hook(
					id,
					"gatekeeper",
					async (ticket) => {
						logger.info(`[Gatekeeper] Verifying ${ticket.bead_id}`, {
							beadId: ticket.bead_id,
						});
						const agent = new EvaluatorAgent();
						const bead = await this.beads.get(ticket.bead_id);

						const submittedWork = this.queue.getOutput(ticket.bead_id);

						if (!submittedWork) {
							logger.warn(
								`[Gatekeeper] No submitted work found for ${ticket.bead_id} (retrieved 'null' from queue). Evaluator may reject.`,
								{ beadId: ticket.bead_id },
							);
						}

						try {
							await agent.run(`Verify this work: ${bead.title}`, {
								beadId: ticket.bead_id,
								bead,
								submitted_work: submittedWork,
							});

							// Check if the bead was actually transitioned by the agent
							const finalBead = await this.beads.get(ticket.bead_id);

							if (finalBead.status === "verify") {
								// Agent exited without calling approve_work or reject_work
								logger.warn(
									`[Gatekeeper] Agent exited without decision for ${ticket.bead_id}`,
									{ beadId: ticket.bead_id },
								);
								await this.beads.update(ticket.bead_id, {
									status: "verify",
									labels: [...(finalBead.labels || []), "evaluator-incomplete"],
								});
								// Note: We keep it in 'verify' so it can be re-evaluated
							}
						} catch (error) {
							// Agent crashed - keep in verify for retry
							logger.error(
								`[Gatekeeper] Agent failed for ${ticket.bead_id}`,
								error,
							);
							await this.beads.update(ticket.bead_id, {
								status: "verify",
								labels: [...(bead.labels || []), "evaluator-error"],
							});
						}
					},
					this.queue,
					3,
				), // Default 3 retries for gatekeeper
			this.config.gatekeeper.min_workers,
		);
	}

	async start() {
		if (this.isRunning) return;
		this.isRunning = true;
		logger.info("[Conductor] Starting...");

		// Initialize MCP
		await getMCPService().initialize();

		// Check environment sanity
		const healthy = await this.validateEnvironment();
		if (!healthy) {
			this.isRunning = false;
			await getMCPService().shutdown();
			return;
		}

		// Start Pools
		this.workerPool.start();
		this.gatekeeperPool.start();

		// Start Router Loop
		this.routerLoop();
	}

	async stop() {
		this.isRunning = false;
		logger.info("[Conductor] Stopping...");

		this.workerPool.stop();
		this.gatekeeperPool.stop();

		if (this.routerTimer) {
			clearTimeout(this.routerTimer);
			this.routerTimer = null;
		}

		// Shutdown MCP
		await getMCPService().shutdown();
	}

	private async validateEnvironment(): Promise<boolean> {
		logger.info("[Conductor] Validating environment...");
		const healthy = await this.beads.doctor();
		if (!healthy) {
			logger.error(
				'[Conductor] Environment check failed! "bd doctor" reports issues.',
			);
			logger.error(
				'[Conductor] Please run "bd doctor" and "bd sync" manually to fix data integrity issues.',
			);
			return false;
		}
		return true;
	}

	private async routerLoop() {
		if (!this.isRunning) return;

		let nextDelay = 5000; // Default 5s

		try {
			await this.cycleRouter();
			await this.scalePools();

			// Success! Reset failures
			this.consecutiveFailures = 0;
		} catch (error) {
			this.consecutiveFailures++;

			// Exponential backoff: 5s * 2^failures, max ~5m (300s)
			const backoff = Math.min(5000 * 2 ** this.consecutiveFailures, 300000);
			nextDelay = backoff;

			logger.error(
				`[Conductor] Cycle failed (attempt ${this.consecutiveFailures}). Backing off for ${Math.round(nextDelay / 1000)}s:`,
				error,
			);
		}

		if (this.isRunning) {
			this.routerTimer = setTimeout(() => this.routerLoop(), nextDelay);
		}
	}

	private async cycleRouter() {
		const beadsClient = this.beads;
		const queue = this.queue;

		// 1. Fetch Candidates (Ready or Verify)
		// We fetch 'ready' (open beads with all blockers closed) for workers
		// and 'verify' (for gatekeepers)

		// Strategy:
		// A. Get READY beads (open + all blockers closed) -> Send to Worker
		const readyBeads = await beadsClient.ready();

		if (!readyBeads) {
			logger.error("[Conductor] readyBeads is undefined!");
			return;
		}

		// --- Stuck Bead Recovery ---
		// Detect beads stuck in 'in_progress' with no active ticket and reset them
		const inProgressBeads = await beadsClient.list("in_progress");
		for (const bead of inProgressBeads) {
			const active = queue.getActiveTicket(bead.id);
			if (!active) {
				// RACE CONDITION FIX: Apply grace period
				// If a ticket was COMPLETED within the last 5 seconds, don't reset yet.
				// This gives the worker time to update the bead status via the CLI.
				const latest = queue.getLatestTicket(bead.id);
				const GRACE_PERIOD_MS = 5000;

				if (
					latest &&
					latest.status === "completed" &&
					latest.completed_at &&
					Date.now() - latest.completed_at < GRACE_PERIOD_MS
				) {
					logger.debug(
						`[Router] Deferring reset of bead ${bead.id} (within 5s grace period of ticket completion)`,
						{ beadId: bead.id },
					);
					continue;
				}

				logger.warn(
					`[Router] Resetting stuck bead ${bead.id} (in_progress with no active ticket)`,
					{ beadId: bead.id },
				);
				await beadsClient.update(bead.id, {
					status: "open",
					labels: [
						...(bead.labels || []).filter((l) => l !== "auto-recovered"),
						"auto-recovered",
					],
				});
			}
		}

		for (const bead of readyBeads) {
			const active = queue.getActiveTicket(bead.id);
			if (!active) {
				// Double-check: ensure bead is STILL open (race condition protect)
				const fresh = await beadsClient.get(bead.id);
				if (fresh.status !== "open") {
					logger.info(
						`[Router] Skipping ${bead.id} (status changed to ${fresh.status})`,
						{ beadId: bead.id },
					);
					continue;
				}

				// Skip container/epic beads - they are for organizational purposes only
				if (fresh.type === "epic") {
					logger.info(`[Router] Skipping container/epic bead ${bead.id}`, {
						beadId: bead.id,
					});
					continue;
				}

				// ATOMICITY: specific check for beads being cooked by WorkflowEngine
				if (fresh.labels?.includes("molecule:cooking")) {
					logger.debug(`[Router] Skipping cooking bead ${bead.id}`, {
						beadId: bead.id,
					});
					continue;
				}

				// Race Condition Fix: Double check blockers
				if (fresh.blockers && fresh.blockers.length > 0) {
					const blockers = await Promise.all(
						fresh.blockers.map((id) => beadsClient.get(id)),
					);
					const activeBlockers = blockers.filter((b) => b.status !== "done");

					if (activeBlockers.length > 0) {
						logger.warn(
							`[Router] Skipping ${bead.id} - incorrectly marked ready (blocked by ${activeBlockers.map((b) => b.id).join(", ")})`,
							{ beadId: bead.id },
						);
						continue;
					}
				}

				// --- Recovery Logic ---
				// Recovery beads should only execute if their dependency (the main task) failed.
				// If all blockers are done and none failed, we skip the recovery bead.
				if (fresh.labels?.includes("recovery")) {
					const blockers = fresh.blockers || [];
					if (blockers.length > 0) {
						const blockerBeads = await Promise.all(
							blockers.map((id) => beadsClient.get(id)),
						);
						const anyFailed = blockerBeads.some((b) =>
							b.labels?.includes("failed"),
						);
						const allDone = blockerBeads.every((b) => b.status === "done");

						if (allDone && !anyFailed) {
							logger.info(
								`[Router] Skipping recovery bead ${bead.id} (all dependencies succeeded)`,
								{ beadId: bead.id },
							);
							await beadsClient.update(bead.id, {
								status: "done",
								acceptance_test:
									"Skipped: All dependencies succeeded without failure.",
							});
							continue;
						}
					}
				}

				// --- Data Piping ---
				// Try to resolve dynamic context dependencies
				// If context still has unresolved references, we wait.
				const piped = await getPiper().pipeData(bead.id);
				if (piped) {
					logger.info(`[Router] Piped data for ${bead.id}`);
				}

				// Re-fetch to check context state
				const currentBead = await beadsClient.get(bead.id);
				if (currentBead.context) {
					const ctxString = JSON.stringify(currentBead.context);
					if (ctxString.includes("{{steps.")) {
						logger.info(
							`[Router] Skipping ${bead.id} (waiting for dependency data)`,
							{ beadId: bead.id },
						);
						continue;
					}
				}

				logger.info(`[Router] Found ready bead: ${bead.id}`, {
					beadId: bead.id,
				});
				// Ask RouterAgent to route it
				await this.routerAgent.run(
					`New task found: ${bead.title}. Please route it.`,
					{ beadId: bead.id, status: bead.status },
				);
			}
		}

		// B. Get VERIFY beads -> Send to Gatekeeper
		// Note: 'verify' is mapped to in_progress + label 'verify' in our beads client logic?
		const verifyBeads = await beadsClient.list("verify");
		for (const bead of verifyBeads) {
			const active = queue.getActiveTicket(bead.id);
			if (!active) {
				const fresh = await beadsClient.get(bead.id);
				if (fresh.status !== "verify") {
					continue;
				}

				logger.info(`[Router] Found unassigned verify bead: ${bead.id}`, {
					beadId: bead.id,
				});
				await this.routerAgent.run(
					`Task ready for verification: ${bead.title}. Please route to gatekeeper.`,
					{ beadId: bead.id, status: bead.status },
				);
			} else {
				// CLEANUP: Check for Zombie Worker Ticket
				// If bead is 'verify' but active ticket is 'worker' (processing or queued), the worker is effectively done/stuck.
				if (active.target_role === "worker" && active.status !== "completed") {
					logger.warn(
						`[Router] Found zombie worker ticket for verify bead ${bead.id}. Cleaning up.`,
						{ beadId: bead.id, ticketId: active.id },
					);

					// Force complete the ticket to allow gatekeeper assignment
					try {
						// @ts-expect-error - Accessing private DB for explicit cleanup
						this.queue.db.run(
							`UPDATE tickets SET status = 'completed', completed_at = ? WHERE id = ?`,
							[Date.now(), active.id],
						);
					} catch (e) {
						logger.error(
							`[Router] Failed to cleanup zombie ticket ${active.id}`,
							e,
						);
					}
					// Continue to next cycle to pick it up as free
				}
			}
		}
	}

	private async scalePools() {
		// Scale Workers
		const workerPending = this.queue.getPendingCount("worker");
		let targetWorkers = Math.ceil(
			workerPending * this.config.worker.load_factor,
		);
		// Ensure bounds
		targetWorkers = Math.max(
			this.config.worker.min_workers,
			Math.min(targetWorkers, this.config.worker.max_workers),
		);

		await this.workerPool.resize(targetWorkers);

		// Scale Gatekeepers
		const gatekeeperPending = this.queue.getPendingCount("gatekeeper");
		let targetGatekeepers = Math.ceil(
			gatekeeperPending * this.config.gatekeeper.load_factor,
		);
		targetGatekeepers = Math.max(
			this.config.gatekeeper.min_workers,
			Math.min(targetGatekeepers, this.config.gatekeeper.max_workers),
		);

		await this.gatekeeperPool.resize(targetGatekeepers);
	}
}
