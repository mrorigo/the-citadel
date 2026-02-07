
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { unlink } from "node:fs/promises";
import { WorkQueue } from "../../src/core/queue";
import { Conductor } from "../../src/services/conductor";
import { setConfig, resetConfig } from "../../src/config";
import { type PearlsClient, type Pearl, type CreateOptions, setPearlsInstance } from "../../src/core/pearls";
import { clearGlobalSingleton } from "../../src/core/registry";
import type { WorkerPool } from "../../src/core/pool";

type TestConductor = {
    workerPool: WorkerPool;
    scalePools: () => Promise<void>;
};

// Mock dependencies
const mockPearlsCreate = mock();
const mockPearlsUpdate = mock();
const mockPearlsList = mock();
const mockPearlsGet = mock();

class MockPearlsClient {
    private store = new Map<string, Pearl>();

    async create(title: string, opts: CreateOptions) {
        mockPearlsCreate(title, opts);
        const id = `bd-${Date.now()}-${Math.random()}`;
        const now = new Date().toISOString();
        const pearl: Pearl = {
            id,
            title,
            status: 'open',
            priority: 1,
            created_at: now,
            updated_at: now,
            labels: [],
            ...opts
        };
        this.store.set(id, pearl);
        return pearl;
    }
    async update(id: string, updates: Partial<Pearl>) {
        mockPearlsUpdate(id, updates);
        const existing = this.store.get(id);
        if (!existing) throw new Error(`Pearl ${id} not found`);
        const updated = { ...existing, ...updates };
        this.store.set(id, updated);
        return updated;
    }
    async list(status: string) {
        mockPearlsList(status);
        return Array.from(this.store.values()).filter(b => b.status === status);
    }
    async get(id: string) {
        mockPearlsGet(id);
        const pearl = this.store.get(id);
        if (!pearl) {
            // For test stability, return a dummy if not found but requested by ID
            // This happens if queue has IDs not in our store
            const now = new Date().toISOString();
            return {
                id,
                title: 'Mock Pearl',
                status: 'open',
                labels: [],
                priority: 1,
                created_at: now,
                updated_at: now
            } as Pearl;
        }
        return pearl;
    }
}

describe("Concurrency Integration", () => {
    let queue: WorkQueue;
    let pearls: MockPearlsClient;
    let conductor: Conductor;
    let dbPath: string;

    beforeEach(() => {
        dbPath = `.citadel/test-queue-${Date.now()}.sqlite`;
        queue = new WorkQueue(dbPath);
        pearls = new MockPearlsClient();
        setPearlsInstance(pearls as unknown as PearlsClient);

        // Reset mocks
        mockPearlsList.mockReset();
        mockPearlsGet.mockReset();

        // Default Config
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            pearls: { path: '.pearls' },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            }
        });
    });

    afterEach(async () => {
        clearGlobalSingleton('pearls_client');
        if (conductor) await conductor.stop();
        if (queue) queue.close();
        if (dbPath) {
            try {
                await unlink(dbPath);
            } catch (e) {
                // Ignore if not exists
            }
        }
        resetConfig();
    });

    test("should scale workers based on load factor", async () => {
        // Setup config: load_factor 0.5 => 1 worker per 2 tasks
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            pearls: { path: '.pearls' },
            worker: { min_workers: 1, max_workers: 10, load_factor: 0.5 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            }
        });

        conductor = new Conductor(pearls as unknown as PearlsClient, queue);

        // Initial state: 0 tasks, should be min_workers = 1 (initialized in constructor)
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(1);

        // 1. Enqueue 10 tasks
        for (let i = 0; i < 10; i++) {
            // We must create them in the store first so update() works
            const id = `bd-${i}`;
            const pearl = {
                id,
                title: `Task ${i}`,
                status: 'open',
                priority: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                labels: []
            } as Pearl;
            (pearls as any).store.set(id, pearl);

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
            pearls: { path: '.pearls' },
            worker: { min_workers: 2, max_workers: 4, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            }
        });

        conductor = new Conductor(pearls as unknown as PearlsClient, queue);
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(2); // Min

        // Enqueue 100 tasks
        for (let i = 0; i < 100; i++) {
            const id = `bd-${i}`;
            const pearl = {
                id,
                title: `Task ${i}`,
                status: 'open',
                priority: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                labels: []
            } as Pearl;
            (pearls as any).store.set(id, pearl);

            queue.enqueue(id, 1, 'worker');
        }

        await (conductor as unknown as TestConductor).scalePools();
        expect((conductor as unknown as TestConductor).workerPool.size).toBe(4); // Max
    });
});
