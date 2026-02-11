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
                labels: options.labels || [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                //... other fields
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

            // Handle label addition logic simply
            if (changes.labels) {
                // In real client, update accepts labels to ADD.
                // Here we just replace or merge? 
                // The real client uses --add-label.
                // But Conductor passes { labels: [...] } which usually means overwrite or append?
                // Conductor usage: labels: [...(current.labels || []), "new-label"]
                // So it passes Key-Value pair as replacement in the object.
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

    test("should not route verify pearl twice within 10 seconds", async () => {
        // Create a pearl in verify status
        // Create a pearl in verify status
        const pearl = await pearls.create("Test Verification Task", {
            status: "verify",
            type: "task",
        });
        const pearlId = pearl.id;

        // Mock router agent run to avoid actual LLM calls
        conductor["routerAgent"].run = mock(async (prompt, context) => {
            // Artificial delay to simulate LLM latency and increase race window
            await new Promise(r => setTimeout(r, 100));
            queue.enqueue(context.pearlId, 2, "gatekeeper");
            return "Routed to gatekeeper";
        });

        // Run two cycles "concurrently"
        // Without the fix, both might pass the checks and call run()
        const p1 = conductor["cycleRouter"]();
        const p2 = conductor["cycleRouter"]();

        await Promise.all([p1, p2]);

        // Verify successful routing happened exactly once
        expect(conductor["routerAgent"].run).toHaveBeenCalledTimes(1);
    });

    // Helper to simulate TOCTOU
    test("should detect ticket created between checks (TOCTOU)", async () => {
        const pearl = await pearls.create("Test TOCTOU", {
            status: "verify",
            type: "task",
        });
        const pearlId = pearl.id;

        // Mock router agent
        conductor["routerAgent"].run = mock(async () => "Routed");

        // Simulate race condition: ticket created between checks
        let checkCount = 0;
        const originalGetActiveTicket = queue.getActiveTicket.bind(queue);
        queue.getActiveTicket = (id: string) => {
            checkCount++;
            if (checkCount === 1) {
                // First check: no ticket
                return null;
            } else if (checkCount === 2) {
                // Second check (the one we will add): ticket appeared (race condition simulated)
                // We inject a ticket now
                const ticketId = "race-ticket";
                // We can't easily inject into sqlite mid-transaction if specific lock, but here it's fine
                // But better to just mock return
                return { id: "race-ticket", status: "queued" } as any;
            }
            return originalGetActiveTicket(id);
        };

        // This test *SHOULD FAIL* before we implement the Fix 3 (double check)
        // Because current code only checks once.
        // Actually, if we only check once, we won't even trigger the second check logic we plan to add.
        // So this test is designed to verifying the *fix*, not strictly reproducing the failure 
        // unless we assert that "routerAgent.run" was NOT called.

        // If we run this on CURRENT code:
        // checkCount=1 (returns null) -> proceeds to routerAgent.run()
        // routerAgent.run called -> FAIL (we want it to skip)

        await conductor["cycleRouter"]();

        // With current code, this expect should FAIL (it will be called 1 time)
        // With fix, it should PASS (called 0 times)
        expect(conductor["routerAgent"].run).toHaveBeenCalledTimes(0);

        // Restore
        queue.getActiveTicket = originalGetActiveTicket;
    });

});
