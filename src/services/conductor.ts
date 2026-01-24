import { RouterAgent } from '../agents/router';
import { WorkerAgent } from '../agents/worker';
import { EvaluatorAgent } from '../agents/evaluator';
import { Hook } from '../core/hooks';
import { getQueue } from '../core/queue';
import { getBeads } from '../core/beads';
import { getConfig } from '../config';

export class Conductor {
    private isRunning = false;
    private routerAgent = new RouterAgent();
    private routerTimer: Timer | null = null;

    // Hooks
    private workerHook: Hook;
    private gatekeeperHook: Hook;

    constructor() {
        // Initialize Hooks
        // Workers process 'worker' tasks using WorkerAgent
        this.workerHook = new Hook('worker-1', 'worker', async (ticket) => {
            console.log(`[Worker] Processing ${ticket.bead_id}`);
            const agent = new WorkerAgent();
            // Provide context
            const bead = await getBeads().get(ticket.bead_id);
            await agent.run(`Process this task: ${bead.title}\nDescription: ${bead.content}`, { beadId: ticket.bead_id, bead });
        });

        // Gatekeepers process 'gatekeeper' tasks using EvaluatorAgent
        this.gatekeeperHook = new Hook('gatekeeper-1', 'gatekeeper', async (ticket) => {
            console.log(`[Gatekeeper] Verifying ${ticket.bead_id}`);
            const agent = new EvaluatorAgent();
            const bead = await getBeads().get(ticket.bead_id);
            await agent.run(`Verify this work: ${bead.title}`, { beadId: ticket.bead_id, bead });
        });
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[Conductor] Starting...');

        // Start Hooks
        this.workerHook.start();
        this.gatekeeperHook.start();

        // Start Router Loop
        this.routerLoop();
    }

    stop() {
        this.isRunning = false;
        console.log('[Conductor] Stopping...');

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
            console.error('[Conductor] Router cycle failed:', error);
        }

        if (this.isRunning) {
            // Run every 5 seconds
            this.routerTimer = setTimeout(() => this.routerLoop(), 5000);
        }
    }

    private async cycleRouter() {
        const beadsClient = getBeads();
        const queue = getQueue();

        // 1. Fetch Candidates (Open or Verify)
        // Currently beads client 'list' filters by status.
        // We need to fetch 'open' (for workers) and 'verify' (for gatekeepers)

        // Strategy: 
        // A. Get OPEN beads -> Send to Worker
        const openBeads = await beadsClient.list({ status: 'open' });
        for (const bead of openBeads) {
            const active = queue.getActiveTicket(bead.id);
            if (!active) {
                console.log(`[Router] Found unassigned open bead: ${bead.id}`);
                // Ask RouterAgent to route it
                // We could just hardcode enqueue, but let's use the agent's brain for priority
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
        const verifyBeads = await beadsClient.list({ status: 'verify' });
        for (const bead of verifyBeads) {
            const active = queue.getActiveTicket(bead.id);
            if (!active) {
                console.log(`[Router] Found unassigned verify bead: ${bead.id}`);
                await this.routerAgent.run(
                    `Task ready for verification: ${bead.title}. Please route to gatekeeper.`,
                    { beadId: bead.id, status: bead.status }
                );
            }
        }
    }
}
