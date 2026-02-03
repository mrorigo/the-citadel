import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ENV = join(process.cwd(), `tests/temp_e2e_env_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
const TEST_BEADS_PATH = join(TEST_ENV, '.beads');
const TEST_QUEUE_PATH = join(TEST_ENV, 'queue.sqlite');

// 1. Mock Registry (Ultimate Isolation)
const localRegistry: Record<string, any> = {};
mock.module('../../src/core/registry', () => ({
    getGlobalSingleton: (key: string, factory: () => any) => {
        if (!localRegistry[key]) {
            localRegistry[key] = factory();
        }
        return localRegistry[key];
    },
    setGlobalSingleton: (key: string, value: any) => {
        localRegistry[key] = value;
    },
    clearGlobalSingleton: (key: string) => {
        delete localRegistry[key];
    }
}));

// 2. Mock Agents
mock.module('../../src/agents/router', () => ({
    RouterAgent: class MockRouter {
        static testQueue: any = null;
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const { beadId, status } = context || {};
            console.log(`[MockRouter] Analyze ${beadId} (${status})`);

            // Use injected test queue (with fallback if needed, but we expect injection)
            // @ts-ignore
            const { getQueue } = await import('../../src/core/queue');
            // @ts-ignore
            const q = globalThis.__TEST_QUEUE__ || MockRouter.testQueue || getQueue();

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
        static beadsClient: any = null;
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const client = MockWorker.beadsClient;
            if (!client) throw new Error("MockWorker: beadsClient not injected");

            console.log(`[Worker] Moving ${context.beadId} to in_progress...`);
            await client.update(context.beadId, { status: 'in_progress' });
            console.log(`[Worker] Moving ${context.beadId} to verify...`);
            await client.update(context.beadId, { status: 'verify' });
            return "Work done";
        }
    }
}));

mock.module('../../src/agents/evaluator', () => ({
    EvaluatorAgent: class MockEvaluator {
        static beadsClient: any = null;
        // biome-ignore lint/suspicious/noExplicitAny: Mocking context
        async run(_prompt: string, context: any) {
            const client = MockEvaluator.beadsClient;
            if (!client) throw new Error("MockEvaluator: beadsClient not injected");

            console.log(`[Gatekeeper] Approving ${context.beadId}...`);
            await client.update(context.beadId, { status: 'done' });
            return "Approved";
        }
    }
}));


// 3. Dynamic Imports for System Under Test
// We use top-level await to load them AFTER the mocks are registered.
const { Conductor } = await import('../../src/services/conductor');
const { WorkQueue, setQueueInstance } = await import('../../src/core/queue');
const { BeadsClient, setBeadsInstance } = await import('../../src/core/beads');


describe('E2E Lifecycle', () => {
    let conductor: InstanceType<typeof Conductor>;
    let beadsClient: InstanceType<typeof BeadsClient>;

    beforeEach(async () => {
        await rm(TEST_ENV, { recursive: true, force: true });
        await mkdir(TEST_BEADS_PATH, { recursive: true });

        const queueInstance = new WorkQueue(TEST_QUEUE_PATH);
        setQueueInstance(queueInstance);

        // Inject into MockRouter
        const { RouterAgent } = await import('../../src/agents/router');
        // @ts-ignore
        RouterAgent.testQueue = queueInstance;
        // @ts-ignore
        globalThis.__TEST_QUEUE__ = queueInstance;

        beadsClient = new BeadsClient(TEST_BEADS_PATH);
        setBeadsInstance(beadsClient);
        await beadsClient.init();

        // Inject into MockWorker/Evaluator
        const { WorkerAgent } = await import('../../src/agents/worker');
        // @ts-ignore
        WorkerAgent.beadsClient = beadsClient;

        const { EvaluatorAgent } = await import('../../src/agents/evaluator');
        // @ts-ignore
        EvaluatorAgent.beadsClient = beadsClient;

        // 0. Test Worker Pool (Guaranteed Real Implementation)
        // We define this inline to avoid any mock leakage from src/core/pool
        class TestWorkerPool {
            hooks: any[] = [];
            role: string;
            factory: (id: string) => any;

            constructor(role: string, factory: (id: string) => any, initialSize: number = 1) {
                this.role = role;
                this.factory = factory;
                this.resize(initialSize);
            }

            get size() { return this.hooks.length; }

            async resize(targetSize: number) {
                if (targetSize > this.size) {
                    const add = targetSize - this.size;
                    for (let i = 0; i < add; i++) {
                        const id = `${this.role}-${Date.now()}-${i}`;
                        const hook = this.factory(id);
                        // Ensure hook starts!
                        if (hook && typeof hook.start === 'function') {
                            hook.start();
                        } else {
                            console.error(`[TestWorkerPool] Factory returned invalid hook for ${id}`, hook);
                        }
                        this.hooks.push(hook);
                    }
                } else {
                    // shrink logic if needed
                    while (this.size > targetSize) {
                        const h = this.hooks.pop();
                        if (h?.stop) h.stop();
                    }
                }
            }
            start() { this.hooks.forEach(h => h.start && h.start()); }
            stop() { this.hooks.forEach(h => h.stop && h.stop()); }
        }

        // Config is passed, but we also manually create pools to ensure they are "Real"
        // 4. Inject Config directly (Bypass global state)
        const testConfig = {
            env: 'development',
            providers: {},
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' },
                supervisor: { provider: 'ollama', model: 'mock' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1, min_workers: 1, max_workers: 2, load_factor: 1 },
            gatekeeper: { min_workers: 1, max_workers: 1, load_factor: 1 },
            beads: { path: TEST_BEADS_PATH, autoSync: true },
            bridge: { maxLogs: 1000 }
        };

        const { setConfig } = await import('../../src/config');
        setConfig(testConfig as any);

        // Inject Config AND Pool Class
        // @ts-ignore
        conductor = new Conductor(beadsClient, queueInstance, testConfig, TestWorkerPool);
    });

    afterEach(async () => {
        if (conductor) conductor.stop();
        // @ts-ignore
        delete globalThis.__TEST_QUEUE__;
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
        // Increased timeout for full suite runs
        while (Date.now() - start < 30000) {
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
        while (Date.now() - start < 60000) {
            const b = await beadsClient.get(bead.id);
            if (b.status === 'done') {
                done = true;
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        expect(done).toBe(true);
    }, 60000); // 60s buffer
});
