
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PearlsClient, setPearlsInstance } from '../src/core/pearls';
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
    constructor(pearls: PearlsClient, queue: WorkQueue, config?: any, PoolClass?: any) {
        super(pearls, queue, config, PoolClass);
        // Mock the router agent to avoid LLM calls
        this['routerAgent'] = {
            run: async (prompt: string, context: any) => {
                // Simple heuristic: if context has status verify, route to gatekeeper
                if (context?.status === 'verify') {
                    queue.enqueue(context.pearlId, 2, 'gatekeeper');
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
    let pearls: PearlsClient;
    let queue: WorkQueue;
    let conductor: TestConductor;
    let tempDir: string;

    beforeEach(async () => {
        // Setup initial config for Pearls
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            pearls: { path: '.pearls', binary: 'prl' },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 },
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            }
        });

        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');

        // Use a separate test DB for queue to avoid messing with real data
        queue = new WorkQueue(':memory:');

        // Setup temp dir for pearls
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-repro-'));

        // IMPORTANT: Pearls requires a git repo
        const execAsync = promisify(require('node:child_process').exec);
        await execAsync('git init', { cwd: tempDir });

        pearls = new PearlsClient(join(tempDir, '.pearls'));
        await pearls.init();

        conductor = new TestConductor(pearls, queue, undefined, MockPool);
        setPearlsInstance(pearls);
    });

    afterEach(() => {
        if (queue) queue.close();
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
        resetConfig();
    });

    it('should route to Gatekeeper even if a zombie worker ticket exists', async () => {
        // 1. Create a pearl
        const pearl = await pearls.create('Zombie Test Pearl');

        // 2. Simulate Worker starting work (create a processing ticket)
        queue.enqueue(pearl.id, 1, 'worker');
        const workerTicket = queue.claim('worker-agent-1', 'worker');
        expect(workerTicket).not.toBeNull();
        expect(workerTicket?.status).toBe('processing');

        // Simulate Worker actually running (updating pearl status)
        await pearls.update(pearl.id, { status: 'in_progress' });

        // 3. Simulate Worker finishing implicitly (update pearl status, but TICKET remains processing)
        // This is the "Zombie" state: Pearl is verify, Worker Ticket is processing.
        await pearls.update(pearl.id, { status: 'verify' });

        // 4. Run Router Cycle
        // Cycle 1: Janitor detects zombie and cleans it up.
        await conductor.cycleRouterPublic();

        // Cycle 2: Router sees free verify pearl and assigns it.
        await conductor.cycleRouterPublic();

        // 5. Check if Gatekeeper ticket was created
        // We expect a NEW ticket with target_role='gatekeeper' to be queued.
        const gatekeeperTicket = queue['db'].query(`
            SELECT * FROM tickets 
            WHERE pearl_id = ? AND target_role = 'gatekeeper'
        `).get(pearl.id);

        // 6. Assert - This should FAIL currently
        expect(gatekeeperTicket).toBeDefined();
        // @ts-ignore
        expect(gatekeeperTicket.status).toBe('queued');
    });
});
