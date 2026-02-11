import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Conductor } from "../../src/services/conductor";
import { WorkQueue } from "../../src/core/queue";
import { PearlsClient } from "../../src/core/pearls";
import { clearGlobalSingleton, setGlobalSingleton } from "../../src/core/registry";
import { setConfig } from "../../src/config";
import type { CitadelConfig } from "../../src/config/schema";

// Mock config
const mockConfig: CitadelConfig = {
    env: "development",
    providers: {
        openai: { apiKey: "mock-key" },
    },
    worker: {
        min_workers: 1,
        max_workers: 2,
        load_factor: 1,
        maxRetries: 3,
        timeout: 300,
        costLimit: 1.0,
    },
    gatekeeper: {
        min_workers: 1,
        max_workers: 2,
        load_factor: 1,
    },
    agents: {
        router: { provider: "openai", model: "mock-model", mcpTools: [] },
        worker: { provider: "openai", model: "mock-model", mcpTools: [] },
        gatekeeper: { provider: "openai", model: "mock-model", mcpTools: [] },
    },
    pearls: {
        path: ".pearls",
        binary: "prl",
        autoSync: false,
    },
    bridge: {
        maxLogs: 100,
    },
    // @ts-ignore
    context: {
        maxHistoryMessages: 10,
        maxToolResponseSize: 1000,
        maxMessageSize: 2000,
    },
};

describe("Router Race Conditions", () => {
    let conductor: Conductor;
    let queue: WorkQueue;
    let pearls: PearlsClient;

    // Mock PearlsClient
    class MockPearlsClient extends PearlsClient {
        private pearls: Map<string, any> = new Map();

        async create(title: string, options: any = {}): Promise<any> {
            const id = `prl-${Math.random().toString(36).substring(7)}`;
            const pearl = {
                id,
                title,
                status: options.status || "open",
                type: options.type || "task",
                priority: options.priority || 2,
                labels: options.labels || [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            this.pearls.set(id, pearl);
            return pearl;
        }

        async get(id: string): Promise<any> {
            const pearl = this.pearls.get(id);
            if (!pearl) throw new Error(`Pearl ${id} not found`);
            return pearl;
        }

        async list(status?: string): Promise<any[]> {
            const all = Array.from(this.pearls.values());
            if (status) return all.filter(p => p.status === status);
            return all;
        }

        async ready(): Promise<any[]> {
            return this.list("open");
        }

        async update(id: string, changes: any): Promise<any> {
            const pearl = await this.get(id);
            const updated = { ...pearl, ...changes, updated_at: new Date().toISOString() };

            if (changes.labels) {
                updated.labels = changes.labels;
            }

            this.pearls.set(id, updated);
            return updated;
        }

        async doctor() { return true; }
    }

    beforeEach(async () => {
        // Setup test environment
        queue = new WorkQueue(":memory:");
        pearls = new MockPearlsClient(":memory:") as unknown as PearlsClient;

        setGlobalSingleton("work_queue", queue);
        setGlobalSingleton("pearls_client", pearls);
        setConfig(mockConfig);

        conductor = new Conductor(pearls, queue, mockConfig);
    });

    afterEach(() => {
        clearGlobalSingleton("work_queue");
        clearGlobalSingleton("pearls_client");
        mock.restore();
    });

    test("should route verify pearl deterministically to gatekeeper", async () => {
        // Create a pearl in verify status
        const pearl = await pearls.create("Test Verification Task", {
            status: "verify",
            type: "task",
            priority: 1,
        });
        const pearlId = pearl.id;

        // Spy on queue.enqueue to verify it's called
        const originalEnqueue = queue.enqueue.bind(queue);
        const enqueueSpy = mock(originalEnqueue);
        queue.enqueue = enqueueSpy;

        // Run cycle
        await conductor["cycleRouter"]();

        // Verify enqueue was called with correct parameters (deterministic routing)
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(pearlId, 1, "gatekeeper");
    });

    test("should detect ticket created between checks (TOCTOU)", async () => {
        const pearl = await pearls.create("Test TOCTOU", {
            status: "verify",
            type: "task",
            priority: 2,
        });
        const pearlId = pearl.id;

        // Spy on queue.enqueue
        const originalEnqueue = queue.enqueue.bind(queue);
        const enqueueSpy = mock(originalEnqueue);
        queue.enqueue = enqueueSpy;

        // Simulate race condition: ticket created between checks
        let checkCount = 0;
        const originalGetActiveTicket = queue.getActiveTicket.bind(queue);
        queue.getActiveTicket = (id: string) => {
            checkCount++;
            if (checkCount === 1) {
                // First check: no ticket
                return null;
            } else if (checkCount === 2) {
                // Second check (TOCTOU protection): ticket appeared
                return { id: "race-ticket", status: "queued" } as any;
            }
            return originalGetActiveTicket(id);
        };

        await conductor["cycleRouter"]();

        // With TOCTOU protection, enqueue should NOT be called
        expect(enqueueSpy).toHaveBeenCalledTimes(0);

        // Restore
        queue.getActiveTicket = originalGetActiveTicket;
    });

    test("should route OPEN pearl deterministically to worker", async () => {
        // Create a pearl in OPEN status
        const pearl = await pearls.create("Test Open Task", {
            status: "open",
            type: "task",
            priority: 3,
        });
        const pearlId = pearl.id;

        // Spy on queue.enqueue
        const originalEnqueue = queue.enqueue.bind(queue);
        const enqueueSpy = mock(originalEnqueue);
        queue.enqueue = enqueueSpy;

        // Run cycle
        await conductor["cycleRouter"]();

        // Verify enqueue was called with correct parameters (deterministic routing)
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(pearlId, 3, "worker");
    });

});
