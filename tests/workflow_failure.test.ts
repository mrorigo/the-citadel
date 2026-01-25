
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { FormulaRegistry } from '../src/core/formula';
import { WorkflowEngine } from '../src/services/workflow-engine';
import { Conductor } from '../src/services/conductor';
import { setBeadsInstance, type Bead } from '../src/core/beads';
import { setConfig } from '../src/config';

mock.module('../src/agents/router', () => ({
    RouterAgent: class {
        run = mock(async () => { });
    }
}));

describe('Workflow Failure Handling', () => {
    const testRoot = join(process.cwd(), '.test_workflow_failure');
    const formulasDir = join(testRoot, 'formulas');

    let registry: FormulaRegistry;
    let engine: WorkflowEngine;
    let beadsMock: any;
    let store: Map<string, any>;

    beforeEach(async () => {
        // Setup Config
        setConfig({
            providers: {
                ollama: { baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' }
            },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            beads: { path: '.beads', binary: 'bd' }
        });
        await rm(testRoot, { recursive: true, force: true });
        await mkdir(formulasDir, { recursive: true });

        const formulaContent = `
formula = "recovery_flow"
description = "Flow with recovery"

[[steps]]
id = "main"
title = "Main Task"
description = "Doing something that might fail"
on_failure = "recovery"

[[steps]]
id = "recovery"
title = "Recovery Task"
description = "Cleaning up after main failure"
`;
        await writeFile(join(formulasDir, 'recovery_flow.toml'), formulaContent);

        registry = new FormulaRegistry(formulasDir);
        await registry.loadAll();
        engine = new WorkflowEngine(registry);

        store = new Map<string, any>();
        beadsMock = {
            create: mock(async (title: string, options: any) => {
                const id = `bd-${Math.random().toString(36).substr(2, 5)}`;
                const bead = { id, title, status: 'open', privacy: 'public', ...options };
                store.set(id, bead);
                return bead;
            }),
            get: mock(async (id: string) => store.get(id)),
            update: mock(async (id: string, changes: any) => {
                const current = store.get(id);
                if (!current) throw new Error(`Bead not found: ${id}`);
                const updated = { ...current, ...changes };
                if (changes.labels && current.labels) {
                    updated.labels = [...new Set([...current.labels, ...changes.labels])];
                }
                store.set(id, updated);
                return updated;
            }),
            addDependency: mock(async (child: string, parent: string) => {
                const c = store.get(child);
                if (!c) throw new Error(`Child not found: ${child}`);
                c.blockers = [...(c.blockers || []), parent];
            }),
            list: mock(async (status: string) => {
                return Array.from(store.values()).filter(b => b.status === status);
            })
        };
        setBeadsInstance(beadsMock);
    });

    afterEach(async () => {
        await rm(testRoot, { recursive: true, force: true });
    });

    it('should label recovery beads correctly during instantiation', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        // Find recovery bead in store
        const recoveryBead = Array.from(store.values()).find(b => b.title === 'Recovery Task');
        expect(recoveryBead).toBeDefined();

        expect(recoveryBead.labels).toContain('recovery');
        expect(recoveryBead.labels.some((l: string) => l.startsWith('recovers:bd-'))).toBe(true);
    });

    it('should skip recovery bead if main task succeeds', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        const mainBead = Array.from(store.values()).find(b => b.title === 'Main Task');
        const recoveryBead = Array.from(store.values()).find(b => b.title === 'Recovery Task');

        // Simulate success
        await beadsMock.update(mainBead.id, { status: 'done' });

        // Run Conductor cycle
        const conductor = new Conductor(beadsMock);
        // @ts-ignore - access private for test
        await conductor.cycleRouter();

        // Check if recovery bead is now done
        const finalRecovery = store.get(recoveryBead.id);
        expect(finalRecovery.status).toBe('done');
    });

    it('should NOT skip recovery bead if main task fails', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        const mainBead = Array.from(store.values()).find(b => b.title === 'Main Task');
        const recoveryBead = Array.from(store.values()).find(b => b.title === 'Recovery Task');

        // Simulate failure (done + failed label)
        await beadsMock.update(mainBead.id, { status: 'done', labels: ['failed'] });

        // Run Conductor cycle
        const conductor = new Conductor(beadsMock);
        // @ts-ignore - access private for test
        await conductor.cycleRouter();

        // Check if recovery bead is STILL open (ready for worker)
        const finalRecovery = store.get(recoveryBead.id);
        expect(finalRecovery.status).toBe('open');
    });

    it('should correctly mark work as failed via EvaluatorAgent tool', async () => {
        const { EvaluatorAgent } = await import('../src/agents/evaluator');
        const agent = new EvaluatorAgent();
        const beadId = 'bd-test1';
        store.set(beadId, { id: beadId, title: 'Test Task', status: 'verify', labels: [] });

        const failTool = (agent as any).tools['fail_work'];
        await failTool.execute({ beadId, reason: 'Test Reason' });

        const updated = store.get(beadId);
        expect(updated.status).toBe('done');
        expect(updated.labels).toContain('failed');
    });
});
