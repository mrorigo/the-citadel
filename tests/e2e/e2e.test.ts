import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import { WorkQueue, setQueueInstance } from '../../src/core/queue';
import { BeadsClient, setBeadsInstance } from '../../src/core/beads';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Mock Agents to force deterministic behavior without LLM costs
mock.module('../../src/agents/router', () => ({
    RouterAgent: class MockRouter {
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const { beadId, status } = context || {};
            console.log(`[MockRouter] Analyze ${beadId} (${status})`);
            // We need to access the real Queue using the singleton accessor, 
            // which we will inject with our instance.
            const q = (await import('../../src/core/queue')).getQueue();

            if (status === 'open') {
                console.log(`[MockRouter] Enqueuing ${beadId} for worker`);
                q.enqueue(beadId, 0, 'worker');
                return "Routed to worker";
            } else if (status === 'verify') {
                console.log(`[MockRouter] Enqueuing ${beadId} for gatekeeper`);
                q.enqueue(beadId, 0, 'gatekeeper');
                return "Routed to gatekeeper";
            }
            return "No action";
        }
    }
}));

mock.module('../../src/agents/worker', () => ({
    WorkerAgent: class MockWorker {
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const beads = new BeadsClient(TEST_BEADS_PATH);
            console.log(`[Worker] Moving ${context.beadId} to in_progress...`);
            await beads.update(context.beadId, { status: 'in_progress' });
            console.log(`[Worker] Moving ${context.beadId} to verify...`);
            await beads.update(context.beadId, { status: 'verify' });
            return "Work done";
        }
    }
}));

mock.module('../../src/agents/evaluator', () => ({
    EvaluatorAgent: class MockEvaluator {
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const beads = new BeadsClient(TEST_BEADS_PATH);
            console.log(`[Gatekeeper] Approving ${context.beadId}...`);
            await beads.update(context.beadId, { status: 'done' });
            return "Approved";
        }
    }
}));

const TEST_ENV = join(process.cwd(), 'tests/temp_e2e_env');
const TEST_BEADS_PATH = join(TEST_ENV, '.beads');
const TEST_QUEUE_PATH = join(TEST_ENV, 'queue.sqlite');

// Inject Config
import { setConfig } from '../../src/config';
setConfig({
    env: 'development',
    providers: {},
    agents: {
        router: { provider: 'ollama', model: 'mock' },
        worker: { provider: 'ollama', model: 'mock' },
        gatekeeper: { provider: 'ollama', model: 'mock' },
        supervisor: { provider: 'ollama', model: 'mock' }
    },
    worker: { timeout: 300, maxRetries: 3, costLimit: 1 },
    beads: { path: TEST_BEADS_PATH, autoSync: true }
});

describe('E2E Lifecycle', () => {
    let conductor: Conductor;
    let beadsClient: BeadsClient;

    beforeEach(async () => {
        await rm(TEST_ENV, { recursive: true, force: true });
        await mkdir(TEST_BEADS_PATH, { recursive: true });

        // Init Real Queue at temp path and inject it
        const queueInstance = new WorkQueue(TEST_QUEUE_PATH);
        setQueueInstance(queueInstance);

        // Init Real Beads Client and inject it
        beadsClient = new BeadsClient(TEST_BEADS_PATH);
        setBeadsInstance(beadsClient);

        conductor = new Conductor();
    });

    afterEach(async () => {
        if (conductor) conductor.stop();
        await rm(TEST_ENV, { recursive: true, force: true });
    });

    it('should drive a task from creation to completion', async () => {
        // 1. Create a Task (Open)
        const bead = await beadsClient.create('E2E Task', { priority: 0, acceptance_test: 'Verify it works' });
        expect(bead.status).toBe('open');

        // Debug: Check list visibility
        const list = await beadsClient.list('open');
        console.log(`[Test] Pre-start list: found ${list.length} items`);
        if (list.length > 0) {
            console.log(`[Test] Item 0: ${JSON.stringify(list[0])}`);
        }

        // 2. Start Conductor
        conductor.start();

        // 3. Wait for Router -> Worker -> Verify
        const start = Date.now();
        let verified = false;
        while (Date.now() - start < 4000) {
            const b = await beadsClient.get(bead.id);
            if (b.status === 'verify') {
                verified = true;
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        expect(verified).toBe(true);

        // 4. Wait for Router -> Gatekeeper -> Done
        let done = false;
        while (Date.now() - start < 15000) {
            const b = await beadsClient.get(bead.id);
            if (b.status === 'done') {
                done = true;
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        expect(done).toBe(true);
    }, 12000); // Including buffer
});
