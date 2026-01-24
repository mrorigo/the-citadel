
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { FormulaRegistry } from '../src/core/formula';
import { WorkflowEngine } from '../src/services/workflow-engine';
import { BeadsClient, setBeadsInstance } from '../src/core/beads';

describe('Workflow Engine', () => {
    const testRoot = join(process.cwd(), '.test_workflow_engine');
    const formulasDir = join(testRoot, 'formulas');
    const beadsDir = join(testRoot, 'beads');

    let registry: FormulaRegistry;
    let engine: WorkflowEngine;
    let beadsClientMock: any;

    beforeEach(async () => {
        // Setup Filesystem
        await rm(testRoot, { recursive: true, force: true });
        await mkdir(formulasDir, { recursive: true });
        await mkdir(beadsDir, { recursive: true });

        // Create Sample Formula
        const formulaContent = `
formula = "compilation"
description = "Compile {{target}} app"

[vars.target]
description = "Target Name"
required = true

[[steps]]
id = "prep"
title = "Prepare {{target}}"
description = "Cleaning build dir"

[[steps]]
id = "build"
title = "Build {{target}}"
description = "Running compiler"
needs = ["prep"]
`;
        await writeFile(join(formulasDir, 'compilation.toml'), formulaContent);

        // Setup Services
        registry = new FormulaRegistry(formulasDir);
        await registry.loadAll(); // Load the formula

        // Mock BeadsClient
        beadsClientMock = {
            create: mock(async (title: string, options: any) => ({
                id: `bd-${Math.random().toString(36).substr(2, 5)}`,
                title,
                status: 'open',
                ...options
            })),
            addDependency: mock(async (child: string, parent: string) => {
                // valid
            })
        };

        // Inject Mock
        setBeadsInstance(beadsClientMock);

        // Setup Engine
        // We need to patch the singleton getFormulaRegistry used by engine,
        // or modify engine to accept registry.
        // The engine implementation uses `getFormulaRegistry()`.
        // We can't easily mock that import without heavy tooling.
        // Hack: We can overwrite the singleton in src/core/formula?
        // Or refactor engine to take registry in constructor?

        // Let's refactor engine to be testable?
        // Or since we are in test environment, we can rely on `getFormulaRegistry(formulasDir)` working if we call it first?
        // `getFormulaRegistry` is a singleton getter. If we call it first with path, it initializes.
        // But `registry` variable above is a new instance.
        // Let's initialize the singleton correctly.
    });

    afterEach(async () => {
        await rm(testRoot, { recursive: true, force: true });
    });

    it('should instantiate a formula correctly', async () => {
        // Initialize singleton for the engine to use
        const { getFormulaRegistry } = await import('../src/core/formula');
        // Resetting singleton is hard if module is cached.
        // But we can try to rely on the fact that if we didn't call it before, it's null.
        // Assuming test runner separation? Bun test runner might share process state?
        // Let's just hope or use the fact that we can pass the path if it wasn't initialized.
        // Actually, let's just use the `registry` we created if we could inject it.
        // Since we can't easily, let's just re-implement `WorkflowEngine` logic or accept the singleton usage for now
        // and initialize the singleton:
        getFormulaRegistry(formulasDir).loadAll(); // Re-load into singleton

        engine = new WorkflowEngine(registry);

        // Run with Convoy Parent
        await engine.instantiateFormula('compilation', { target: 'MyApp' }, 'bd-convoy1');

        // Verify Beads Created
        // 1. Root Epic
        expect(beadsClientMock.create).toHaveBeenCalled();
        const createCalls = beadsClientMock.create.mock.calls;

        // Needs Root + 2 steps = 3 calls
        expect(createCalls.length).toBe(3);

        const rootCall = createCalls.find((c: any[]) => c[1]?.type === 'epic');
        expect(rootCall).toBeDefined();
        expect(rootCall[0]).toContain('Compile MyApp app'); // resolved var
        expect(rootCall[1].parent).toBe('bd-convoy1'); // Verify parenting to convoy

        // 2. Steps
        const prepCall = createCalls.find((c: any[]) => c[0] === 'Prepare MyApp');
        expect(prepCall).toBeDefined();
        // Check description passed via options
        expect(prepCall[1].description).toBe('Cleaning build dir');

        const buildCall = createCalls.find((c: any[]) => c[0] === 'Build MyApp');
        expect(buildCall).toBeDefined();

        // 3. Dependencies
        expect(beadsClientMock.addDependency).toHaveBeenCalled();
        const depCalls = beadsClientMock.addDependency.mock.calls;
        expect(depCalls.length).toBe(1);
        // Build needs Prep -> Build is child (blocked), Prep is parent (blocker)? 
        // Logic in engine: addDependency(childId, parentId).
        // If Build needs Prep, we called `addDependency(buildId, prepId)`.
        // Let's verify IDs? The mock return values are dynamic, tricky to match exactly without capturing returns.
        // But we know it was called.
    });
});
