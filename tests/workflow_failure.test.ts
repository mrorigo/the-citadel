
import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { FormulaRegistry } from '../src/core/formula';
import { WorkflowEngine } from '../src/services/workflow-engine';
import { Conductor } from '../src/services/conductor';
import { setPearlsInstance } from '../src/core/pearls';
import { setConfig, resetConfig } from '../src/config';
import { EvaluatorAgent } from '../src/agents/evaluator';
import { clearGlobalSingleton } from '../src/core/registry';

// Mock getAgentModel to return dummy models
mock.module('../src/core/llm', () => ({
    getAgentModel: (role: string) => {
        if (!['router', 'worker', 'gatekeeper', 'supervisor'].includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }
        return {
            specificationVersion: 'v2',
            provider: 'mock',
            modelId: 'mock-model',
            doGenerate: async () => ({
                content: [{ type: 'text', text: 'Mocked Plan' }],
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 }
            })
        };
    }
}));



describe('Workflow Failure Handling', () => {
    const testRoot = join(process.cwd(), '.test_workflow_failure');
    const formulasDir = join(testRoot, 'formulas');

    let registry: FormulaRegistry;
    let engine: WorkflowEngine;
    // biome-ignore lint/suspicious/noExplicitAny: mock
    let pearlsMock: any;
    // biome-ignore lint/suspicious/noExplicitAny: mock
    let store: Map<string, any>;

    beforeEach(async () => {
        // Setup Config
        setConfig({
            providers: {
                ollama: { baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' }
            },
            agents: {
                worker: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            pearls: { path: '.pearls', binary: 'bd' }
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

        // biome-ignore lint/suspicious/noExplicitAny: mock
        store = new Map<string, any>();
        pearlsMock = {
            // biome-ignore lint/suspicious/noExplicitAny: mock
            create: mock(async (title: string, options: any) => {
                const id = `bd-${Math.random().toString(36).substr(2, 5)}`;
                const pearl = { id, title, status: 'open', privacy: 'public', ...options };
                store.set(id, pearl);
                return pearl;
            }),
            get: mock(async (id: string) => store.get(id)),
            // biome-ignore lint/suspicious/noExplicitAny: mock
            update: mock(async (id: string, changes: any) => {
                const current = store.get(id);
                if (!current) throw new Error(`Pearl not found: ${id}`);
                const updated = { ...current, ...changes };
                if (changes.labels && current.labels) {
                    updated.labels = [...new Set([...current.labels, ...changes.labels])];
                }
                if (changes.remove_labels && current.labels) {
                    updated.labels = current.labels.filter((l: string) => !changes.remove_labels.includes(l));
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
            }),
            ready: mock(async () => {
                // Return pearls that are 'open' and have all blockers 'done'
                return Array.from(store.values()).filter(b => {
                    if (b.status !== 'open') return false;
                    if (!b.blockers || b.blockers.length === 0) return true;
                    return b.blockers.every((blockerId: string) => {
                        const blocker = store.get(blockerId);
                        return blocker && blocker.status === 'done';
                    });
                });
            })
        };

        registry = new FormulaRegistry(formulasDir);
        await registry.loadAll();
        engine = new WorkflowEngine(registry, pearlsMock);
    });

    afterEach(async () => {
        await rm(testRoot, { recursive: true, force: true });
    });

    afterAll(async () => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        clearGlobalSingleton('piper');
        resetConfig();
    });

    it('should label recovery pearls correctly during instantiation', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        // Find recovery pearl in store
        const recoveryPearl = Array.from(store.values()).find(b => b.title === 'Recovery Task');
        expect(recoveryPearl).toBeDefined();

        expect(recoveryPearl.labels).toContain('recovery');
        expect(recoveryPearl.labels.some((l: string) => l.startsWith('recovers:bd-'))).toBe(true);
    });

    it('should skip recovery pearl if main task succeeds', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        const mainPearl = Array.from(store.values()).find(b => b.title === 'Main Task');
        const recoveryPearl = Array.from(store.values()).find(b => b.title === 'Recovery Task');

        // Simulate success
        await pearlsMock.update(mainPearl.id, { status: 'done' });

        // Run Conductor cycle
        const conductor = new Conductor(pearlsMock);
        // @ts-expect-error - access private for test
        await conductor.cycleRouter();
        await conductor.stop();

        // Check if recovery pearl is now done
        const finalRecovery = store.get(recoveryPearl.id);
        expect(finalRecovery.status).toBe('done');
    });

    it('should NOT skip recovery pearl if main task fails', async () => {
        await engine.instantiateFormula('recovery_flow', {});

        const mainPearl = Array.from(store.values()).find(b => b.title === 'Main Task');
        const recoveryPearl = Array.from(store.values()).find(b => b.title === 'Recovery Task');

        // Simulate failure (done + failed label)
        await pearlsMock.update(mainPearl.id, { status: 'done', labels: ['failed'] });

        // Run Conductor cycle
        const conductor = new Conductor(pearlsMock);
        // @ts-expect-error - access private for test
        await conductor.cycleRouter();
        await conductor.stop();

        // Check if recovery pearl is STILL open (ready for worker)
        const finalRecovery = store.get(recoveryPearl.id);
        expect(finalRecovery.status).toBe('open');
    });

    it('should correctly mark work as failed via EvaluatorAgent tool', async () => {
        const agent = new EvaluatorAgent(undefined, pearlsMock);
        const pearlId = 'bd-test1';
        store.set(pearlId, { id: pearlId, title: 'Test Task', status: 'verify', labels: [] });

        // biome-ignore lint/suspicious/noExplicitAny: access private for test
        const failTool = (agent as any).tools.fail_work;
        await failTool.execute({ reason: 'Test Reason' }, { toolCallId: 'call-fail', messages: [], pearlId } as any);

        const updated = store.get(pearlId);
        expect(updated.status).toBe('done');
        expect(updated.labels).toContain('failed');
    });
});
