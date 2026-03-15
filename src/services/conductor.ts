import { EvaluatorAgent } from "../agents/evaluator";
import { WorkerAgent } from "../agents/worker";
import { getConfig } from "../config";
import type { CitadelConfig } from "../config/schema";
import { type AgentContext, CoreAgent, AgentStepLimitReachedError } from "../core/agent";
import { type AgentRole } from "../config/schema";
import { type PearlsClient, getPearls, type Pearl } from "../core/pearls";
import { Hook } from "../core/hooks";
import { logger } from "../core/logger";
import { WorkerPool } from "../core/pool";
import { getQueue, type WorkQueue } from "../core/queue";
import { getMCPService } from "./mcp";
import { getPiper } from "./piper";

export class Conductor {
	private isRunning = false;
	private routerTimer: Timer | null = null;
	private consecutiveFailures = 0;
	private config: CitadelConfig;

	// Pools
	private pools: Map<string, WorkerPool> = new Map();
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

		// Initialize Specialized Worker Pools
		// We create a pool for every agent role defined in the configuration (except gatekeeper)
		const roles = Object.keys(this.config.agents).filter(r => r !== 'gatekeeper');
		for (const role of roles) {
			const pool = new PoolClass(
				role,
				(id: string) =>
					new Hook(
						id,
						role,
						async (ticket) => {
							logger.info(`[${role}] Processing ${ticket.pearl_id}`, {
								pearlId: ticket.pearl_id,
							});

							const pearl = await this.pearls.get(ticket.pearl_id).catch(() => null);
							if (!pearl) {
								logger.error(
									`[${role}] Failed to retrieve pearl ${ticket.pearl_id} for processing`,
									{ pearlId: ticket.pearl_id },
								);
								this.queue.fail(ticket.id, true);
								return;
							}

							// Ensure the pearl is in progress and assigned to this role
							await this.pearls.update(ticket.pearl_id, {
								status: "in_progress",
								assignee: role,
							});

							logger.info(`[${role}] Instantiating agent for role: ${role}`, { pearlId: ticket.pearl_id });

							// Execute onPearlStart lifecycle hook
							if (this.config.hooks?.onPearlStart) {
								try {
									await this.config.hooks.onPearlStart(pearl);
								} catch (err) {
									logger.error(`[${role}] Error in onPearlStart hook:`, err);
								}
							}

							const agent = new WorkerAgent(role);

							try {
								let prompt = `Process this task: ${pearl.title}`;

								// Injection: Retry Reminder
								if (ticket.retry_count > 0) {
									prompt = `# RETRY ATTEMPT #${ticket.retry_count}\n\n${prompt}\n\n**IMPORTANT**: Your previous attempt for this task was interrupted (possibly due to step limits or unexpected exit). Please resume where you left off and ensure you use 'submit_work' once finished. Check the logs and current state to avoid repeating work.`;
								}

								const result = await agent.run(
									prompt,
									{ pearlId: ticket.pearl_id, pearl },
								);

								// Check if the pearl was actually transitioned by the agent
								const finalPearl = await this.pearls.get(ticket.pearl_id);

								if (finalPearl.status === "in_progress") {
									// Agent exited without calling submit_work
									logger.warn(
										`[${role}] Agent exited without submitting work for ${ticket.pearl_id}. Force-throwing error to trigger queue retry.`,
										{ pearlId: ticket.pearl_id },
									);
									// Throwing here instead of completing ensures Hook calls queue.fail()
									throw new Error(`Agent finished execution but did not submit work (pearl remains 'in_progress').`);
								}
								return result;
							} catch (error: any) {
								if (error instanceof AgentStepLimitReachedError) {
									logger.error(`[${role}] Agent hit step limit for ${ticket.pearl_id}. Failing for retry.`, error);
									// Rethrow to let Hook handle queue failure/retry
									throw error;
								}

								// Agent crashed - mark as failed
								logger.error(
									`[${role}] Agent failed for ${ticket.pearl_id}`,
									error,
								);
								const currentLabels = pearl?.labels || [];
								await this.pearls.update(ticket.pearl_id, {
									status: "open",
									labels: [...currentLabels, "failed", "agent-error"],
								});
								// Rethrow to ensure ticket is failed in queue
								throw error;
							}
						},
						this.queue,
						this.config.worker.maxRetries,
					),
				this.config.worker.min_workers,
			);
			this.pools.set(role, pool);
		}

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

						// Update assignee for gatekeeper work
						await this.pearls.update(ticket.pearl_id, { assignee: "gatekeeper" });

						const submittedWork = pearl.output || this.queue.getOutput(ticket.pearl_id);

						if (!submittedWork) {
							logger.warn(
								`[Gatekeeper] No submitted work found for ${ticket.pearl_id} (retrieved 'null' from queue). Evaluator may reject.`,
								{ pearlId: ticket.pearl_id },
							);
						}

						// Execute onPearlStart lifecycle hook
						if (this.config.hooks?.onPearlStart) {
							try {
								await this.config.hooks.onPearlStart(pearl);
							} catch (err) {
								logger.error(`[Gatekeeper] Error in onPearlStart hook:`, err);
							}
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
		for (const pool of this.pools.values()) {
			pool.start();
		}
		this.gatekeeperPool.start();

		// Start Router Loop
		this.routerLoop();
	}

	async stop() {
		this.isRunning = false;
		logger.info("[Conductor] Stopping...");

		for (const pool of this.pools.values()) {
			pool.stop();
		}
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
		} catch (error: unknown) {
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

		// 0. Zombie Cleanup: Release tickets that haven't pulsed a heartbeat in 15m
		try {
			const released = queue.releaseStalled(15 * 60 * 1000);
			if (released > 0) {
				logger.info(`[Router] Released ${released} stalled/zombie tickets`);
			}
		} catch (e) {
			logger.error("[Router] Failed to release stalled tickets", e);
		}

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

				// HITL Protection: NEVER auto-reset HITL tasks
				if (pearl.labels?.includes("hitl") || pearl.labels?.includes("escalation")) {
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
			} else if (pearl.labels?.includes("agent-error") || pearl.labels?.includes("failed")) {
				// We have an active ticket, but the pearl is flagged with an error.
				// This usually means a previous run failed, but the current run is retrying.
				// WE DO NOTHING HERE. Let the active ticket finish or fail.
				logger.debug(`[Router] Skipping reset of failed pearl ${pearl.id} - active ticket exists.`, { pearlId: pearl.id });
			}
		}

		for (const pearl of readyPearls) {
			const active = queue.getActiveTicket(pearl.id);
			if (!active) {
				// Double-check: ensure pearl is STILL open
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
					// Check for Auto-Close
					if (this.config.gatekeeper.auto_close_epics) {
						// 1. Get explicit blockers
						const blockers = fresh.blockers || [];

						// 2. Get implicit children (parent_child links) from the database
						// This is expensive but necessary because the CLI doesn't yet provide 'children' in the 'show' output
						const allPearls = await pearlsClient.getAll();
						const children = allPearls.filter(p => p.parent === pearl.id);
						const childrenIds = children.map(c => c.id);

						const combinedBlockers = [...new Set([...blockers, ...childrenIds])];

						if (combinedBlockers.length > 0) {
							const blockerPearls = await Promise.all(
								combinedBlockers.map((id) => pearlsClient.get(id).catch(() => null))
							);
							const validBlockers = blockerPearls.filter(b => b !== null) as Pearl[];

							const allDone = validBlockers.every((b) => b.status === "done");
							if (allDone && validBlockers.length > 0) {
								logger.info(
									`[Router] Auto-closing Epic ${pearl.id} (all blockers and children completed)`,
									{ pearlId: pearl.id }
								);
								await pearlsClient.update(pearl.id, {
									status: "done",
									acceptance_test: "Auto-closed: All subtasks and children completed.",
								});
								continue;
							}
						}
					}

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

				// Double check blockers
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

				// --- HITL Protection ---
				if (fresh.labels?.includes("hitl") || fresh.labels?.includes("escalation")) {
					logger.info(`[Router] Skipping HITL/Escalation pearl ${pearl.id} (awaiting human action)`, {
						pearlId: pearl.id,
					});
					continue;
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

				// Final TOCTOU check before enqueuing
				const stillNoTicket = queue.getActiveTicket(pearl.id);
				if (stillNoTicket) {
					logger.debug(
						`[Router] Pearl ${pearl.id} already has ticket (race avoided)`,
						{ pearlId: pearl.id },
					);
					continue;
				}

				// Role-based routing
				let targetRole = currentPearl.assignee || (currentPearl.context?.role as string) || (currentPearl.metadata?.role as string) || "worker";

				// Fail-safe: Fallback to 'worker' if role doesn't exist in config
				if (!this.config.agents[targetRole as keyof typeof this.config.agents]) {
					logger.warn(`[Router] Role '${targetRole}' not found in config. Falling back to 'worker' for ${pearl.id}`);
					targetRole = "worker";
				}

				logger.info(`[Router] Routing pearl ${pearl.id} to ${targetRole}`, {
					pearlId: pearl.id,
					targetRole,
				});

				// Deterministic routing: open -> specific role pool
				this.queue.enqueue(pearl.id, currentPearl.priority, targetRole);
			}
		}

		// B. Get VERIFY pearls -> Send to Gatekeeper
		const verifyPearls = await pearlsClient.list("verify");
		for (const pearl of verifyPearls) {
			const active = queue.getActiveTicket(pearl.id);
			if (!active) {
				const fresh = await pearlsClient.get(pearl.id);
				if (fresh.status !== "verify") {
					continue;
				}

				// Final TOCTOU check before enqueuing
				const stillNoTicket = queue.getActiveTicket(pearl.id);
				if (stillNoTicket) {
					logger.debug(
						`[Router] Pearl ${pearl.id} already has ticket (race avoided)`,
						{ pearlId: pearl.id }
					);
					continue;
				}

				logger.info(`[Router] Routing pearl ${pearl.id} to gatekeeper`, {
					pearlId: pearl.id,
				});

				// Deterministic routing: verify -> gatekeeper
				queue.enqueue(pearl.id, fresh.priority, "gatekeeper");
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
		// Scale Workers per pool
		for (const [role, pool] of this.pools.entries()) {
			const pending = this.queue.getPendingCount(role);
			let target = Math.ceil(pending * this.config.worker.load_factor);
			target = Math.max(
				this.config.worker.min_workers,
				Math.min(target, this.config.worker.max_workers),
			);
			await pool.resize(target);
		}

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
