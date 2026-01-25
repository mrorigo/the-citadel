import { RouterAgent } from '../agents/router';
import { WorkerAgent } from '../agents/worker';
import { EvaluatorAgent } from '../agents/evaluator';
import { Hook } from '../core/hooks';
import { getQueue, type WorkQueue } from '../core/queue';
import { getBeads, type BeadsClient } from '../core/beads';
import { logger } from '../core/logger';

export class Conductor {
    private isRunning = false;
    private routerAgent = new RouterAgent();
    private routerTimer: Timer | null = null;

    // Hooks
    private workerHook: Hook;
    private gatekeeperHook: Hook;

    private beads: BeadsClient;
    private queue: WorkQueue;

    constructor(beads?: BeadsClient, queue?: WorkQueue) {
        this.beads = beads || getBeads();
        this.queue = queue || getQueue();

        // Initialize Hooks
        // Workers process 'worker' tasks using WorkerAgent
        this.workerHook = new Hook('worker-1', 'worker', async (ticket) => {
            logger.info(`[Worker] Processing ${ticket.bead_id}`, { beadId: ticket.bead_id });
            const agent = new WorkerAgent();
            // Provide context
            const bead = await this.beads.get(ticket.bead_id);
            await agent.run(`Process this task: ${bead.title}`, { beadId: ticket.bead_id, bead });
        });

        // Gatekeepers process 'gatekeeper' tasks using EvaluatorAgent
        this.gatekeeperHook = new Hook('gatekeeper-1', 'gatekeeper', async (ticket) => {
            logger.info(`[Gatekeeper] Verifying ${ticket.bead_id}`, { beadId: ticket.bead_id });
            const agent = new EvaluatorAgent();
            const bead = await this.beads.get(ticket.bead_id);
            await agent.run(`Verify this work: ${bead.title}`, { beadId: ticket.bead_id, bead });
        });
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('[Conductor] Starting...');

        // Start Hooks
        this.workerHook.start();
        this.gatekeeperHook.start();

        // Start Router Loop
        this.routerLoop();
    }

    stop() {
        this.isRunning = false;
        logger.info('[Conductor] Stopping...');

        this.workerHook.stop();
        this.gatekeeperHook.stop();

        if (this.routerTimer) {
            clearTimeout(this.routerTimer);
            this.routerTimer = null;
        }
    }

    private async routerLoop() {
        if (!this.isRunning) return;

        try {
            await this.cycleRouter();
        } catch (error) {
            logger.error('[Conductor] Router cycle failed:', error);
        }

        if (this.isRunning) {
            // Run every 5 seconds
            this.routerTimer = setTimeout(() => this.routerLoop(), 5000);
        }
    }

    private async cycleRouter() {
        const beadsClient = this.beads;
        const queue = this.queue;

        // 1. Fetch Candidates (Open or Verify)
        // Currently beads client 'list' filters by status.
        // We need to fetch 'open' (for workers) and 'verify' (for gatekeepers)

        // Strategy: 
        // A. Get OPEN beads -> Send to Worker
        const openBeads = await beadsClient.list('open');

        if (!openBeads) {
            logger.error('[Conductor] openBeads is undefined!');
            return;
        }

        for (const bead of openBeads) {
            const active = queue.getActiveTicket(bead.id);
            if (!active) {
                // Double-check: ensure bead is STILL open (race condition protect)
                const fresh = await beadsClient.get(bead.id);
                if (fresh.status !== 'open') {
                    logger.info(`[Router] Skipping ${bead.id} (status changed to ${fresh.status})`, { beadId: bead.id });
                    continue;
                }

                // --- Recovery Logic ---
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

                        if (!anyFailed) {
                            // If not all done and none failed yet, we wait.
                            // But usually `open` status implies blockers ARE done.
                            // If they are done and none failed, we skip.
                        }
                    }
                }

                logger.info(`[Router] Found unassigned open bead: ${bead.id}`, { beadId: bead.id });
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
}
