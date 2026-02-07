import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WorkflowEngine } from "../src/services/workflow-engine";
import { getPearls, setPearlsInstance, PearlsClient } from "../src/core/pearls";
import { FormulaRegistry } from "../src/core/formula";
import { resetConfig, setConfig } from "../src/config";

class MockPearls extends PearlsClient {
    created: any[] = [];
    updates: Map<string, any> = new Map();

    async create(title: string, options: any = {}) {
        const id = `pearl-${Math.random().toString(36).substring(7)}`;
        const p = { id, title, ...options, labels: options.labels || [] };
        this.created.push(p);
        return p as any;
    }

    async update(id: string, changes: any) {
        this.updates.set(id, changes);
        const p = this.created.find(x => x.id === id);
        if (p && changes.labels) {
            p.labels = [...(p.labels || []), ...changes.labels];
        }
        return p as any;
    }

    async get(id: string) {
        return this.created.find(x => x.id === id) as any;
    }
}

describe("Bug Repro: Label Overwriting", () => {
    let mockPearls: MockPearls;
    let engine: WorkflowEngine;
    let registry: FormulaRegistry;

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

        registry = new FormulaRegistry();
        // @ts-ignore
        registry.formulas.set("test_labels", {
            formula: "test_labels",
            description: "Test Labels",
            steps: [
                {
                    id: "step1",
                    title: "Step 1",
                    description: "Step 1 Desc",
                    labels: ["custom:label", "tag:impact"]
                }
            ]
        });

        engine = new WorkflowEngine(registry);
    });

    it("should merge formula-defined labels with system labels", async () => {
        await engine.instantiateFormula("test_labels", {});

        const step1Pearl = mockPearls.created.find(p => p.title === "Step 1");
        expect(step1Pearl).toBeDefined();

        // Check labels
        const labels = step1Pearl.labels;
        expect(labels).toContain("custom:label");
        expect(labels).toContain("tag:impact");
        expect(labels).toContain("step:step1");
        expect(labels).toContain("formula:test_labels");
    });
});
