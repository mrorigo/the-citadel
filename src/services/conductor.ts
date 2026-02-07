import { EvaluatorAgent } from "../agents/evaluator";
import { RouterAgent } from "../agents/router";
import { WorkerAgent } from "../agents/worker";
import { getConfig } from "../config";
import type { CitadelConfig } from "../config/schema";
import { type PearlsClient, getPearls } from "../core/pearls";
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

	private pearls: PearlsClient;
	private queue: WorkQueue;

	constructor(
		pearls?: PearlsClient,
		queue?: WorkQueue,
		config?: CitadelConfig,
		PoolClass: typeof WorkerPool = WorkerPool,
	) {
		this.pearls = pearls || getPearls();
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
						logger.info(`[Worker] Processing ${ticket.pearl_id}`, {
							pearlId: ticket.pearl_id,
						});

						// Move pearl to in_progress when we start processing
						await this.pearls.update(ticket.pearl_id, { status: "in_progress" });

						const agent = new WorkerAgent();
						const pearl = await this.pearls.get(ticket.pearl_id).catch(() => null);

						if (!pearl) {
							logger.error(
								`[Worker] Failed to retrieve pearl ${ticket.pearl_id} for processing`,
								{ pearlId: ticket.pearl_id },
							);
							// We should fail the ticket if the pearl is gone
							this.queue.fail(ticket.id, true);
							return;
						}

						try {
							const result = await agent.run(
								`Process this task: ${pearl.title}`,
								{ pearlId: ticket.pearl_id, pearl },
							);

							// Check if the pearl was actually transitioned by the agent
							const finalPearl = await this.pearls.get(ticket.pearl_id);

							if (finalPearl.status === "in_progress") {
								// Agent exited without calling submit_work - this is a failure
								logger.warn(
									`[Worker] Agent exited without submitting work for ${ticket.pearl_id}`,
									{ pearlId: ticket.pearl_id },
								);
								await this.pearls.update(ticket.pearl_id, {
									status: "open",
									labels: [...(finalPearl.labels || []), "agent-incomplete"],
								});
							}
							return result;
						} catch (error) {
							// Agent crashed - mark as failed
							logger.error(
								`[Worker] Agent failed for ${ticket.pearl_id}`,
								error,
							);
							const currentLabels = pearl?.labels || [];
							await this.pearls.update(ticket.pearl_id, {
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
						logger.info(`[Gatekeeper] Verifying ${ticket.pearl_id}`, {
							pearlId: ticket.pearl_id,
						});
						const agent = new EvaluatorAgent();
						const pearl = await this.pearls.get(ticket.pearl_id);

						const submittedWork = this.queue.getOutput(ticket.pearl_id);

						if (!submittedWork) {
							logger.warn(
								`[Gatekeeper] No submitted work found for ${ticket.pearl_id} (retrieved 'null' from queue). Evaluator may reject.`,
								{ pearlId: ticket.pearl_id },
							);
						}

						try {
							await agent.run(`Verify this work: ${pearl.title}`, {
								pearlId: ticket.pearl_id,
								pearl,
								submitted_work: submittedWork,
							});

							// Check if the pearl was actually transitioned by the agent
							const finalPearl = await this.pearls.get(ticket.pearl_id);

							if (finalPearl.status === "verify") {
								// Agent exited without calling approve_work or reject_work
								logger.warn(
									`[Gatekeeper] Agent exited without decision for ${ticket.pearl_id}`,
									{ pearlId: ticket.pearl_id },
								);
								await this.pearls.update(ticket.pearl_id, {
									status: "verify",
									labels: [...(finalPearl.labels || []), "evaluator-incomplete"],
								});
								// Note: We keep it in 'verify' so it can be re-evaluated
							}
						} catch (error) {
							// Agent crashed - keep in verify for retry
							logger.error(
								`[Gatekeeper] Agent failed for ${ticket.pearl_id}`,
								error,
							);
							await this.pearls.update(ticket.pearl_id, {
								status: "verify",
								labels: [...(pearl.labels || []), "evaluator-error"],
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
		const healthy = await this.pearls.doctor();
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
		const pearlsClient = this.pearls;
		const queue = this.queue;

		// 1. Fetch Candidates (Ready or Verify)
		// We fetch 'ready' (open pearls with all blockers closed) for workers
		// and 'verify' (for gatekeepers)

		// Strategy:
		// A. Get READY pearls (open + all blockers closed) -> Send to Worker
		const readyPearls = await pearlsClient.ready();

		if (!readyPearls) {
			logger.error("[Conductor] readyPearls is undefined!");
			return;
		}

		// --- Stuck Pearl Recovery ---
		// Detect pearls stuck in 'in_progress' with no active ticket and reset them
		const inProgressPearls = await pearlsClient.list("in_progress");
		for (const pearl of inProgressPearls) {
			const active = queue.getActiveTicket(pearl.id);
			if (!active) {
				// RACE CONDITION FIX: Apply grace period
				// If a ticket was COMPLETED within the last 5 seconds, don't reset yet.
				// This gives the worker time to update the pearl status via the CLI.
				const latest = queue.getLatestTicket(pearl.id);
				const GRACE_PERIOD_MS = 5000;

				if (
					latest &&
					latest.status === "completed" &&
					latest.completed_at &&
					Date.now() - latest.completed_at < GRACE_PERIOD_MS
				) {
					logger.debug(
						`[Router] Deferring reset of pearl ${pearl.id} (within 5s grace period of ticket completion)`,
						{ pearlId: pearl.id },
					);
					continue;
				}

				logger.warn(
					`[Router] Resetting stuck pearl ${pearl.id} (in_progress with no active ticket)`,
					{ pearlId: pearl.id },
				);
				await pearlsClient.update(pearl.id, {
					status: "open",
					labels: [
						...(pearl.labels || []).filter((l) => l !== "auto-recovered"),
						"auto-recovered",
					],
				});
			}
		}

		for (const pearl of readyPearls) {
			const active = queue.getActiveTicket(pearl.id);
			if (!active) {
				// Double-check: ensure pearl is STILL open (race condition protect)
				const fresh = await pearlsClient.get(pearl.id);
				if (fresh.status !== "open") {
					logger.info(
						`[Router] Skipping ${pearl.id} (status changed to ${fresh.status})`,
						{ pearlId: pearl.id },
					);
					continue;
				}

				// Skip container/epic pearls - they are for organizational purposes only
				if (fresh.type === "epic") {
					logger.info(`[Router] Skipping container/epic pearl ${pearl.id}`, {
						pearlId: pearl.id,
					});
					continue;
				}

				// ATOMICITY: specific check for pearls being cooked by WorkflowEngine
				if (fresh.labels?.includes("molecule:cooking")) {
					logger.debug(`[Router] Skipping cooking pearl ${pearl.id}`, {
						pearlId: pearl.id,
					});
					continue;
				}

				// Race Condition Fix: Double check blockers
				if (fresh.blockers && fresh.blockers.length > 0) {
					const blockers = await Promise.all(
						fresh.blockers.map((id) => pearlsClient.get(id)),
					);
					const activeBlockers = blockers.filter((b) => b.status !== "done");

					if (activeBlockers.length > 0) {
						logger.warn(
							`[Router] Skipping ${pearl.id} - incorrectly marked ready (blocked by ${activeBlockers.map((b) => b.id).join(", ")})`,
							{ pearlId: pearl.id },
						);
						continue;
					}
				}

				// --- Recovery Logic ---
				// Recovery pearls should only execute if their dependency (the main task) failed.
				// If all blockers are done and none failed, we skip the recovery pearl.
				if (fresh.labels?.includes("recovery")) {
					const blockers = fresh.blockers || [];
					if (blockers.length > 0) {
						const blockerPearls = await Promise.all(
							blockers.map((id) => pearlsClient.get(id)),
						);
						const anyFailed = blockerPearls.some((b) =>
							b.labels?.includes("failed"),
						);
						const allDone = blockerPearls.every((b) => b.status === "done");

						if (allDone && !anyFailed) {
							logger.info(
								`[Router] Skipping recovery pearl ${pearl.id} (all dependencies succeeded)`,
								{ pearlId: pearl.id },
							);
							await pearlsClient.update(pearl.id, {
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
				const piped = await getPiper().pipeData(pearl.id);
				if (piped) {
					logger.info(`[Router] Piped data for ${pearl.id}`);
				}

				// Re-fetch to check context state
				const currentPearl = await pearlsClient.get(pearl.id);
				if (currentPearl.context) {
					const ctxString = JSON.stringify(currentPearl.context);
					if (ctxString.includes("{{steps.")) {
						logger.info(
							`[Router] Skipping ${pearl.id} (waiting for dependency data)`,
							{ pearlId: pearl.id },
						);
						continue;
					}
				}

				logger.info(`[Router] Found ready pearl: ${pearl.id}`, {
					pearlId: pearl.id,
				});
				// Ask RouterAgent to route it
				await this.routerAgent.run(
					`New task found: ${pearl.title}. Please route it.`,
					{ pearlId: pearl.id, status: pearl.status },
				);
			}
		}

		// B. Get VERIFY pearls -> Send to Gatekeeper
		// Note: 'verify' is mapped to in_progress + label 'verify' in our pearls client logic?
		const verifyPearls = await pearlsClient.list("verify");
		for (const pearl of verifyPearls) {
			const active = queue.getActiveTicket(pearl.id);
			if (!active) {
				const fresh = await pearlsClient.get(pearl.id);
				if (fresh.status !== "verify") {
					continue;
				}

				logger.info(`[Router] Found unassigned verify pearl: ${pearl.id}`, {
					pearlId: pearl.id,
				});
				await this.routerAgent.run(
					`Task ready for verification: ${pearl.title}. Please route to gatekeeper.`,
					{ pearlId: pearl.id, status: pearl.status },
				);
			} else {
				// CLEANUP: Check for Zombie Worker Ticket
				// If pearl is 'verify' but active ticket is 'worker' (processing or queued), the worker is effectively done/stuck.
				if (active.target_role === "worker" && active.status !== "completed") {
					logger.warn(
						`[Router] Found zombie worker ticket for verify pearl ${pearl.id}. Cleaning up.`,
						{ pearlId: pearl.id, ticketId: active.id },
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
