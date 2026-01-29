import { RouterAgent } from '../agents/router';
import { WorkerAgent } from '../agents/worker';
import { EvaluatorAgent } from '../agents/evaluator';
import { Hook } from '../core/hooks';
import { WorkerPool } from '../core/pool';
import { getQueue, type WorkQueue } from '../core/queue';
import { getConfig } from '../config';
import { getBeads, type BeadsClient } from '../core/beads';
import { logger } from '../core/logger';
import { getMCPService } from './mcp';
import { getPiper } from './piper';

export class Conductor {
    private isRunning = false;
    private routerAgent = new RouterAgent();
    private routerTimer: Timer | null = null;
    private consecutiveFailures = 0;

    // Pools
    private workerPool: WorkerPool;
    private gatekeeperPool: WorkerPool;

    private beads: BeadsClient;
    private queue: WorkQueue;

    constructor(beads?: BeadsClient, queue?: WorkQueue) {
        this.beads = beads || getBeads();
        this.queue = queue || getQueue();

        const config = getConfig();

        // Initialize Worker Pool
        this.workerPool = new WorkerPool(
            'worker',
            (id) => new Hook(id, 'worker', async (ticket) => {
                logger.info(`[Worker] Processing ${ticket.bead_id}`, { beadId: ticket.bead_id });

                // Move bead to in_progress when we start processing
                await this.beads.update(ticket.bead_id, { status: 'in_progress' });

                const agent = new WorkerAgent();
                const bead = await this.beads.get(ticket.bead_id);

                try {
                    await agent.run(`Process this task: ${bead.title}`, { beadId: ticket.bead_id, bead });

                    // Check if the bead was actually transitioned by the agent
                    const finalBead = await this.beads.get(ticket.bead_id);

                    if (finalBead.status === 'in_progress') {
                        // Agent exited without calling submit_work - this is a failure
                        logger.warn(`[Worker] Agent exited without submitting work for ${ticket.bead_id}`, { beadId: ticket.bead_id });
                        await this.beads.update(ticket.bead_id, {
                            status: 'open',
                            labels: [...(finalBead.labels || []), 'agent-incomplete']
                        });
                    }
                } catch (error) {
                    // Agent crashed - mark as failed
                    logger.error(`[Worker] Agent failed for ${ticket.bead_id}`, error);
                    await this.beads.update(ticket.bead_id, {
                        status: 'open',
                        labels: [...(bead.labels || []), 'failed', 'agent-error']
                    });
                }
            }),
            config.worker.min_workers
        );

        // Initialize Gatekeeper Pool
        this.gatekeeperPool = new WorkerPool(
            'gatekeeper',
            (id) => new Hook(id, 'gatekeeper', async (ticket) => {
                logger.info(`[Gatekeeper] Verifying ${ticket.bead_id}`, { beadId: ticket.bead_id });
                const agent = new EvaluatorAgent();
                const bead = await this.beads.get(ticket.bead_id);

                try {
                    await agent.run(`Verify this work: ${bead.title}`, {
                        beadId: ticket.bead_id,
                        bead,
                        submitted_work: ticket.output
                    });

                    // Check if the bead was actually transitioned by the agent
                    const finalBead = await this.beads.get(ticket.bead_id);

                    if (finalBead.status === 'verify') {
                        // Agent exited without calling approve_work or reject_work
                        logger.warn(`[Gatekeeper] Agent exited without decision for ${ticket.bead_id}`, { beadId: ticket.bead_id });
                        await this.beads.update(ticket.bead_id, {
                            status: 'verify',
                            labels: [...(finalBead.labels || []), 'evaluator-incomplete']
                        });
                        // Note: We keep it in 'verify' so it can be re-evaluated
                    }
                } catch (error) {
                    // Agent crashed - keep in verify for retry
                    logger.error(`[Gatekeeper] Agent failed for ${ticket.bead_id}`, error);
                    await this.beads.update(ticket.bead_id, {
                        status: 'verify',
                        labels: [...(bead.labels || []), 'evaluator-error']
                    });
                }
            }),
            config.gatekeeper.min_workers
        );
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('[Conductor] Starting...');

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
        logger.info('[Conductor] Stopping...');

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
        logger.info('[Conductor] Validating environment...');
        const healthy = await this.beads.doctor();
        if (!healthy) {
            logger.error('[Conductor] Environment check failed! "bd doctor" reports issues.');
            logger.error('[Conductor] Please run "bd doctor" and "bd sync" manually to fix data integrity issues.');
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
            const backoff = Math.min(5000 ** this.consecutiveFailures, 300000);
            nextDelay = backoff;

            logger.error(`[Conductor] Cycle failed (attempt ${this.consecutiveFailures}). Backing off for ${Math.round(nextDelay / 1000)}s:`, error);
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
            logger.error('[Conductor] readyBeads is undefined!');
            return;
        }

        for (const bead of readyBeads) {

            const active = queue.getActiveTicket(bead.id);
            if (!active) {
                // Double-check: ensure bead is STILL open (race condition protect)
                const fresh = await beadsClient.get(bead.id);
                if (fresh.status !== 'open') {
                    logger.info(`[Router] Skipping ${bead.id} (status changed to ${fresh.status})`, { beadId: bead.id });
                    continue;
                }

                // --- Recovery Logic ---
                // Recovery beads should only execute if their dependency (the main task) failed.
                // If all blockers are done and none failed, we skip the recovery bead.
                if (fresh.labels?.includes('recovery')) {
                    const blockers = fresh.blockers || [];
                    if (blockers.length > 0) {
                        const blockerBeads = await Promise.all(blockers.map(id => beadsClient.get(id)));
                        const anyFailed = blockerBeads.some(b => b.labels?.includes('failed'));
                        const allDone = blockerBeads.every(b => b.status === 'done');

                        if (allDone && !anyFailed) {
                            logger.info(`[Router] Skipping recovery bead ${bead.id} (all dependencies succeeded)`, { beadId: bead.id });
                            await beadsClient.update(bead.id, { status: 'done' });
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
                    if (ctxString.includes('{{steps.')) {
                        logger.info(`[Router] Skipping ${bead.id} (waiting for dependency data)`, { beadId: bead.id });
                        continue;
                    }
                }

                logger.info(`[Router] Found ready bead: ${bead.id}`, { beadId: bead.id });
                // Ask RouterAgent to route it
                await this.routerAgent.run(
                    `New task found: ${bead.title}. Please route it.`,
                    { beadId: bead.id, status: bead.status }
                );
            }
        }

        // B. Get VERIFY beads -> Send to Gatekeeper
        // Note: 'verify' is mapped to in_progress + label 'verify' in our beads client logic?
        // Let's check beads.ts. 
        // Yes, mapToDomain maps in_progress+verify -> 'verify'.
        const verifyBeads = await beadsClient.list('verify');
        for (const bead of verifyBeads) {
            const active = queue.getActiveTicket(bead.id);
            if (!active) {
                const fresh = await beadsClient.get(bead.id);
                if (fresh.status !== 'verify') {
                    continue;
                }

                logger.info(`[Router] Found unassigned verify bead: ${bead.id}`, { beadId: bead.id });
                await this.routerAgent.run(
                    `Task ready for verification: ${bead.title}. Please route to gatekeeper.`,
                    { beadId: bead.id, status: bead.status }
                );
            }
        }
    }


    private async scalePools() {
        const config = getConfig();

        // Scale Workers
        const workerPending = this.queue.getPendingCount('worker');
        let targetWorkers = Math.ceil(workerPending * config.worker.load_factor);
        // Ensure bounds
        targetWorkers = Math.max(config.worker.min_workers, Math.min(targetWorkers, config.worker.max_workers));

        await this.workerPool.resize(targetWorkers);

        // Scale Gatekeepers
        const gatekeeperPending = this.queue.getPendingCount('gatekeeper');
        let targetGatekeepers = Math.ceil(gatekeeperPending * config.gatekeeper.load_factor);
        targetGatekeepers = Math.max(config.gatekeeper.min_workers, Math.min(targetGatekeepers, config.gatekeeper.max_workers));

        await this.gatekeeperPool.resize(targetGatekeepers);
    }
}
