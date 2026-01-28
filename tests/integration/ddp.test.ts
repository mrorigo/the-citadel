import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
import { WorkQueue } from '../../src/core/queue';
import { WorkerAgent } from '../../src/agents/worker';
import { z } from 'zod';
import { DataPiper } from '../../src/services/piper';
import { WorkflowEngine } from '../../src/services/workflow-engine';
import { FormulaRegistry, setFormulaRegistry } from '../../src/core/formula';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setQueueInstance } from '../../src/core/queue';
import { setBeadsInstance } from '../../src/core/beads';
import { setGlobalSingleton, clearGlobalSingleton } from '../../src/core/registry';
import { CONFIG_KEY } from '../../src/config';
import type { CitadelConfig } from '../../src/config/schema';

// Mock Config
const MOCK_CONFIG: CitadelConfig = {
    env: 'development',
    providers: { openai: { apiKey: 'mock' } },
    agents: {
        worker: { model: 'mock', provider: 'openai' },
        router: { model: 'mock', provider: 'openai' },
        gatekeeper: { model: 'mock', provider: 'openai' },
        supervisor: { model: 'mock', provider: 'openai' }
    },
    beads: { path: '.beads', binary: 'bd', autoSync: false },
    worker: { min_workers: 1, max_workers: 1, load_factor: 1, timeout: 300, maxRetries: 1, costLimit: 1 },
    gatekeeper: { min_workers: 1, max_workers: 1, load_factor: 1 },
    bridge: { maxLogs: 100 },
    mcpServers: {}
};

const TEST_DIR = resolve(process.cwd(), '.test_ddp');
const DB_PATH = resolve(TEST_DIR, 'queue.sqlite');
const FORMULAS_DIR = resolve(TEST_DIR, '.citadel/formulas');

// Reuse MockBeadsClient logic (simplified inline for this file to avoid complex imports if not exported)
class MockBeadsClient extends BeadsClient {
    public store: Map<string, any> = new Map();

    protected override async runCommand(args: string): Promise<string> {
        // Create
        if (args.startsWith('create')) {
            const titleMatch = args.match(/create "([^"]+)"/);
            const title = titleMatch ? titleMatch[1] : 'Untitled';

            // Extract description with context
            let description = '';
            const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
            if (descMatch && descMatch[1]) {
                description = descMatch[1].replace(/\\"/g, '"');
            }

            const id = `bead-${Math.random().toString(36).substr(2, 9)}`;

            const bead: any = {
                id, title, status: 'open', priority: 0,
                description, labels: [],
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            this.store.set(id, bead);
            return JSON.stringify(bead);
        }

        // Update
        if (args.startsWith('update')) {
            const idPart = args.split(' ')[1];
            if (!idPart) throw new Error('Missing ID');
            const bead = this.store.get(idPart);
            if (!bead) throw new Error('Not found');

            // Handle labels
            if (args.includes('--add-label')) {
                const parts = args.split(' ');
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] === '--add-label' && parts[i + 1]) {
                        const rawLabel = parts[i + 1];
                        if (rawLabel) {
                            const label = rawLabel.replace(/^"|"$/g, '');
                            if (!bead.labels.includes(label)) {
                                bead.labels.push(label);
                            }
                        }
                    }
                }
            }

            // Handle context/description update
            const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
            if (descMatch && descMatch[1]) {
                bead.description = descMatch[1].replace(/\\"/g, '"');
                // update context property for in-memory mock consistency
                // (Real client reparses from desc)
                const match = bead.description.match(/^---\n([\s\S]*?)\n---\n/);
                if (match) {
                    bead.context = JSON.parse(match[1]);
                }
            }

            // Handle status
            if (args.includes('--status closed')) bead.status = 'closed';
            else if (args.includes('--status in_progress')) bead.status = 'in_progress';
            else if (args.includes('--status verify')) bead.status = 'verify'; // Simplified for mock

            this.store.set(idPart, bead);
            return JSON.stringify(bead);
        }

        // Show/Get
        if (args.startsWith('show')) {
            const parts = args.split(' ');
            if (parts.length > 1) {
                const id = parts[1];
                if (id) {
                    return JSON.stringify(this.store.get(id));
                }
            }
        }

        // Dep Add
        if (args.startsWith('dep add')) {
            const parts = args.split(' ');
            if (parts.length >= 4) {
                const child = parts[2];
                const parent = parts[3];
                if (child && parent) {
                    const c = this.store.get(child);
                    if (c) {
                        c.blockers = c.blockers || [];
                        c.blockers.push(parent);
                        this.store.set(child, c);
                    }
                }
                return 'ok';
            }
        }

        return '';
    }

    override async init() { }
}

describe('Dynamic Data Piping', () => {
    let beads: MockBeadsClient;
    let queue: WorkQueue;
    let engine: WorkflowEngine;
    let piper: DataPiper;

    beforeEach(async () => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
        mkdirSync(FORMULAS_DIR, { recursive: true });

        // Fix: Set env var for AI SDK
        process.env.OPENAI_API_KEY = 'mock';

        setGlobalSingleton(CONFIG_KEY, MOCK_CONFIG);

        beads = new MockBeadsClient(TEST_DIR);
        await beads.init();
        setBeadsInstance(beads);

        queue = new WorkQueue(DB_PATH);
        setQueueInstance(queue);

        const registry = new FormulaRegistry(FORMULAS_DIR);
        // Important: set global singleton so WorkerAgent picks it up
        setFormulaRegistry(registry);

        engine = new WorkflowEngine(registry);
        piper = new DataPiper(); // Uses getBeads(), getQueue()
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
    });

    it('should enforce schema and pipe data between steps', async () => {
        // 1. Define Formula
        const formulaContent = `
formula = "ddp_test"
description = "Test piping"

[[steps]]
id = "producer"
title = "Produce Data"
description = "Produces a magic number"

  [steps.output_schema]
  type = "object"
  required = ["magic_number"]
    [steps.output_schema.properties.magic_number]
    type = "number"

[[steps]]
id = "consumer"
title = "Consume Data"
description = "Uses the magic number"
needs = ["producer"]
context = { input_num = "{{steps.producer.output.magic_number}}" }
`;
        writeFileSync(join(FORMULAS_DIR, 'test.toml'), formulaContent);

        const registry = new FormulaRegistry(FORMULAS_DIR);
        await registry.loadAll();
        setFormulaRegistry(registry);
        engine = new WorkflowEngine(registry);

        // 2. Instantiate Molecule
        const rootId = await engine.instantiateFormula('ddp_test', {});

        // Find Bead IDs
        // Iterate store to find beads by title roughly
        let producerId = '';
        let consumerId = '';

        for (const [id, bead] of beads.store.entries()) {
            if (bead.title === 'Produce Data') producerId = id;
            if (bead.title === 'Consume Data') consumerId = id;
        }

        expect(producerId).toBeTruthy();
        expect(consumerId).toBeTruthy();

        // 3. Verify Labels
        const producer = await beads.get(producerId);
        expect(producer.labels).toContain('step:producer');
        expect(producer.labels).toContain('formula:ddp_test');

        // 4. Run Worker on Producer (Verify Schema)
        // Set queue ticket
        queue.enqueue(producerId, 1, 'worker');
        queue.claim('w1', 'worker');

        // Use cache-busting dynamic import to bypass potential mock leaks
        const { WorkerAgent } = await import(`../../src/agents/worker?t=${Date.now()}`);
        const worker = new WorkerAgent();

        // Mock Model to return a Tool Call
        const mockModel = {
            specificationVersion: 'v2',
            provider: 'mock',
            modelId: 'mock-model',
            defaultObjectGenerationMode: 'json',
            doGenerate: async (options: any) => {
                // Return just text
                return {
                    content: [
                        { type: 'text', text: "I have finished the work." }
                    ],
                    finishReason: 'stop',
                    usage: { promptTokens: 0, completionTokens: 0 },
                    rawCall: { rawPrompt: null, rawSettings: {} }
                };
            }
        };
        (worker as any).model = mockModel;

        // Trigger run (this ensures schema is loaded and tool is registered)
        await worker.run('Work', { beadId: producerId });

        // Verify Schema manually
        const submitTool = (worker as any).tools['submit_work'];
        const schema = submitTool.parameters;
        // Check for magic_number in schema
        // Schema is ZodObject.
        // We can check strictness by seeing if it accepts valid data and rejects invalid.

        // 1. Valid Execution
        // Manually move bead to in_progress so submit_work can move it to verify
        await beads.update(producerId, { status: 'in_progress' });

        const validArgs = {
            beadId: producerId,
            summary: 'Done',
            output: { magic_number: 42 }
        };
        await submitTool.execute(validArgs, { toolCallId: 'test', messages: [] });

        let outputTicket = queue.getOutput(producerId);
        expect(outputTicket).toEqual({ magic_number: 42 });

        // 2. Invalid Execution (Missing required field)
        const invalidArgs = {
            beadId: producerId,
            summary: 'Done',
            output: { magic_number: "wrong_type" }
        };

        // Verify schema rejects invalid args
        const parseResult = schema.safeParse(invalidArgs);
        expect(parseResult.success).toBe(false);

        // 3. Invalid Execution (Extra field if strict?) 
        // Default Zod object calls strip unknown keys usually.
        // But jsonSchemaToZod creates a schema.

        // Restore manual submit_work tool call logic removed from run response
        // (Wait, I just replaced the mock response to INCLUDE tool calls, but I wanted to REMOVE them?)
        // Ah, I need to REMOVE the tool call from the mock response in this edit if I want to execute manually.
        // The ReplacementContent above KEEPS the tool call in the mock response... 
        // I should have provided content with JUST text.
        // Let me Correct the ReplacementContent.

        // 5. Pipe Data
        // Piper should look at consumer dependencies (producer) and resolve context
        const piped = await piper.pipeData(consumerId);
        expect(piped).toBe(true);

        const consumer = await beads.get(consumerId);
        // "input_num": "{{steps.producer.output.magic_number}}" -> 42
        // Note: My Piper implementation returns explicit value from output. 
        // 42 is proper number if replacement logic handles specific typing or full replacement.
        // Current logic: `return await this.fetchValue(...)` in `resolveTemplate`.
        // `resolveObject` calls `resolveTemplate`.
        // If template matches full string, exact value is used.
        const consumerRefreshed = await beads.get(consumerId);
        expect(consumerRefreshed.context?.input_num).toBe(42);
    });
});
