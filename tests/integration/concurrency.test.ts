
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { unlink } from "node:fs/promises";
import { WorkQueue } from "../../src/core/queue";
import { Conductor } from "../../src/services/conductor";
import { setConfig } from "../../src/config";
import type { BeadsClient, Bead, CreateOptions } from "../../src/core/beads";
import type { WorkerPool } from "../../src/core/pool";

type TestConductor = {
    workerPool: WorkerPool;
    scalePools: () => Promise<void>;
};

// Mock dependencies
const mockBeadsCreate = mock();
const mockBeadsUpdate = mock();
const mockBeadsList = mock();
const mockBeadsGet = mock();

class MockBeadsClient {
    private store = new Map<string, Bead>();

    async create(title: string, opts: CreateOptions) {
        mockBeadsCreate(title, opts);
        const id = `bd-${Date.now()}-${Math.random()}`;
        const now = new Date().toISOString();
        const bead: Bead = {
            id,
            title,
            status: 'open',
            priority: 1,
            created_at: now,
            updated_at: now,
            labels: [],
            ...opts
        };
        this.store.set(id, bead);
        return bead;
    }
    async update(id: string, updates: Partial<Bead>) {
        mockBeadsUpdate(id, updates);
        const existing = this.store.get(id);
        if (!existing) throw new Error(`Bead ${id} not found`);
        const updated = { ...existing, ...updates };
        this.store.set(id, updated);
        return updated;
    }
    async list(status: string) {
        mockBeadsList(status);
        return Array.from(this.store.values()).filter(b => b.status === status);
    }
    async get(id: string) {
        mockBeadsGet(id);
        const bead = this.store.get(id);
        if (!bead) {
            // For test stability, return a dummy if not found but requested by ID
            // This happens if queue has IDs not in our store
            return { id, title: 'Mock Bead', status: 'open', labels: [] } as Bead;
        }
        return bead;
    }
}

describe("Concurrency Integration", () => {
    let queue: WorkQueue;
    let beads: MockBeadsClient;
    let conductor: Conductor;
    let dbPath: string;

    beforeEach(() => {
        dbPath = `.citadel/test-queue-${Date.now()}.sqlite`;
        queue = new WorkQueue(dbPath);
        beads = new MockBeadsClient();

        // Reset mocks
        mockBeadsList.mockReset();
        mockBeadsGet.mockReset();

        // Default Config
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.beads' },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' }
            }
        });
    });

    afterEach(async () => {
        if (conductor) await conductor.stop();
        if (queue) queue.close();
        if (dbPath) {
            try {
                await unlink(dbPath);
            } catch (e) {
                // Ignore if not exists
            }
        }
    });

    test("should scale workers based on load factor", async () => {
        // Setup config: load_factor 0.5 => 1 worker per 2 tasks
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.beads' },
            worker: { min_workers: 1, max_workers: 10, load_factor: 0.5 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' }
            }
        });

        conductor = new Conductor(beads as unknown as BeadsClient, queue);

        // Initial state: 0 tasks, should be min_workers = 1 (initialized in constructor)
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(1);

        // 1. Enqueue 10 tasks
        for (let i = 0; i < 10; i++) {
            // We must create them in the store first so update() works
            const id = `bd-${i}`;
            const bead = {
                id,
                title: `Task ${i}`,
                status: 'open',
                priority: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                labels: []
            } as Bead;
            (beads as any).store.set(id, bead);

            queue.enqueue(id, 1, 'worker');
        }

        // 2. Trigger scaling
        // We can access private method or just wait for loop? 
        // Accessing private method for unit test precision.
        await (conductor as unknown as TestConductor).scalePools();

        // Target = ceil(10 * 0.5) = 5
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(5);

        // 3. Complete some tasks
        // Mock processing (dequeuing)
        // Actually scalePools looks at *queue depth* (pending count).
        // So we need to claim them to reduce pending count.
        for (let i = 0; i < 8; i++) {
            // Claiming moves from 'queued' to 'processing'
            queue.claim(`worker-x`, 'worker');
        }

        // Remaining pending: 2
        await (conductor as unknown as TestConductor).scalePools();

        // Target = ceil(2 * 0.5) = 1
        // But pool might take time to shrink if we implemented graceful shutdown?
        // Our pool implementation stops immediately if shrink is called.
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(1);
    });

    test("should respect min and max workers", async () => {
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.beads' },
            worker: { min_workers: 2, max_workers: 4, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' }
            }
        });

        conductor = new Conductor(beads as unknown as BeadsClient, queue);
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(2); // Min

        // Enqueue 100 tasks
        for (let i = 0; i < 100; i++) {
            const id = `bd-${i}`;
            const bead = {
                id,
                title: `Task ${i}`,
                status: 'open',
                priority: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                labels: []
            } as Bead;
            (beads as any).store.set(id, bead);

            queue.enqueue(id, 1, 'worker');
        }

        await (conductor as unknown as TestConductor).scalePools();
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(4); // Max
    });
});
