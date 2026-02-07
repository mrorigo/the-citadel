import { describe, it, expect, beforeEach } from "bun:test";
import { DataPiper } from "../src/services/piper";
import { setPearlsInstance, PearlsClient } from "../src/core/pearls";
import { setQueueInstance, WorkQueue } from "../src/core/queue";
import { resetConfig, setConfig } from "../src/config";

class MockPearls extends PearlsClient {
    pearls: Map<string, any> = new Map();

    async get(id: string) {
        return this.pearls.get(id);
    }
    async getAll() {
        return Array.from(this.pearls.values());
    }
    async update(id: string, changes: any) {
        const p = this.pearls.get(id);
        Object.assign(p, changes);
        return p;
    }
}

class MockQueue extends WorkQueue {
    outputs: Map<string, any> = new Map();

    async getOutput(id: string) {
        return this.outputs.get(id);
    }
}

describe("Bug Repro: Piper Shallow Resolution", () => {
    let mockPearls: MockPearls;
    let mockQueue: MockQueue;
    let piper: DataPiper;

    beforeEach(() => {
        resetConfig();
        setConfig({
            env: "development",
            providers: { ollama: {} },
            pearls: { path: ".pearls", binary: "prl" },
            agents: {
                worker: { provider: "ollama", model: "mock" },
                router: { provider: "ollama", model: "mock" },
                gatekeeper: { provider: "ollama", model: "mock" }
            },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 }
        });

        mockPearls = new MockPearls();
        setPearlsInstance(mockPearls);

        mockQueue = new MockQueue();
        setQueueInstance(mockQueue);

        piper = new DataPiper();
    });

    it("should resolve output from a deep dependency (sibling) in the same molecule", async () => {
        const rootEpicId = "epic-1";

        // Step A (Grandparent)
        const pearlA = {
            id: "prl-A",
            parent: rootEpicId,
            labels: ["step:A"],
            context: {}
        };
        mockPearls.pearls.set("prl-A", pearlA);
        mockQueue.outputs.set("prl-A", { foo: "bar" });

        // Step B (Parent blocker of C)
        const pearlB = {
            id: "prl-B",
            parent: rootEpicId,
            labels: ["step:B"],
            blockers: ["prl-A"],
            context: {}
        };
        mockPearls.pearls.set("prl-B", pearlB);

        // Step C (Current)
        // C only blocks on B, but needs A's output
        const pearlC = {
            id: "prl-C",
            parent: rootEpicId,
            labels: ["step:C"],
            blockers: ["prl-B"],
            context: {
                data: "{{steps.A.output.foo}}"
            }
        };
        mockPearls.pearls.set("prl-C", pearlC);

        // Run piper on pearlC
        const changed = await piper.pipeData("prl-C");
        expect(changed).toBe(true);
        expect(pearlC.context.data).toBe("bar");
    });
});
