
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BeadsClient, setBeadsInstance } from '../src/core/beads';
import { WorkQueue } from '../src/core/queue';
import { Conductor } from '../src/services/conductor';
import { clearGlobalSingleton } from '../src/core/registry';
import { setConfig, resetConfig } from '../src/config';
import { logger } from '../src/core/logger';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Mock WorkerPool to avoid actual agents
class MockPool {
    constructor(public role: string, public factory: any, public count: number) { }
    start() { }
    stop() { }
    resize() { }
}

// Subclass Conductor to access private method and mock router
class TestConductor extends Conductor {
    constructor(beads: BeadsClient, queue: WorkQueue, config?: any, PoolClass?: any) {
        super(beads, queue, config, PoolClass);
        // Mock the router agent to avoid LLM calls
        this['routerAgent'] = {
            run: async (prompt: string, context: any) => {
                // Simple heuristic: if context has status verify, route to gatekeeper
                if (context?.status === 'verify') {
                    queue.enqueue(context.beadId, 2, 'gatekeeper');
                }
                return "Mock routed";
            }
        } as any;
    }

    public async cycleRouterPublic() {
        return this['cycleRouter']();
    }
}

describe('Zombie Worker Ticket (Reproduction)', () => {
    let beads: BeadsClient;
    let queue: WorkQueue;
    let conductor: TestConductor;
    let tempDir: string;

    beforeEach(async () => {
        // Setup initial config for Pearls
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.pearls', binary: 'prl' },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 },
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            }
        });

        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');

        // Use a separate test DB for queue to avoid messing with real data
        queue = new WorkQueue(':memory:');

        // Setup temp dir for beads
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-repro-'));

        // IMPORTANT: Pearls requires a git repo
        const execAsync = promisify(require('node:child_process').exec);
        await execAsync('git init', { cwd: tempDir });

        beads = new BeadsClient(join(tempDir, '.pearls'));
        await beads.init();

        conductor = new TestConductor(beads, queue, undefined, MockPool);
        setBeadsInstance(beads);
    });

    afterEach(() => {
        if (queue) queue.close();
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
        resetConfig();
    });

    it('should route to Gatekeeper even if a zombie worker ticket exists', async () => {
        // 1. Create a bead
        const bead = await beads.create('Zombie Test Bead');

        // 2. Simulate Worker starting work (create a processing ticket)
        queue.enqueue(bead.id, 1, 'worker');
        const workerTicket = queue.claim('worker-agent-1', 'worker');
        expect(workerTicket).not.toBeNull();
        expect(workerTicket?.status).toBe('processing');

        // Simulate Worker actually running (updating bead status)
        await beads.update(bead.id, { status: 'in_progress' });

        // 3. Simulate Worker finishing implicitly (update bead status, but TICKET remains processing)
        // This is the "Zombie" state: Bead is verify, Worker Ticket is processing.
        await beads.update(bead.id, { status: 'verify' });

        // 4. Run Router Cycle
        // Cycle 1: Janitor detects zombie and cleans it up.
        await conductor.cycleRouterPublic();

        // Cycle 2: Router sees free verify bead and assigns it.
        await conductor.cycleRouterPublic();

        // 5. Check if Gatekeeper ticket was created
        // We expect a NEW ticket with target_role='gatekeeper' to be queued.
        const gatekeeperTicket = queue['db'].query(`
            SELECT * FROM tickets 
            WHERE bead_id = ? AND target_role = 'gatekeeper'
        `).get(bead.id);

        // 6. Assert - This should FAIL currently
        expect(gatekeeperTicket).toBeDefined();
        // @ts-ignore
        expect(gatekeeperTicket.status).toBe('queued');
    });
});
