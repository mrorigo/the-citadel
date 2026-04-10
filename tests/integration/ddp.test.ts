import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PearlsClient } from '../../src/core/pearls';
import { WorkQueue } from '../../src/core/queue';
import { WorkerAgent } from '../../src/agents/worker';
import { z } from 'zod';
import { DataPiper } from '../../src/services/piper';
import { WorkflowEngine } from '../../src/services/workflow-engine';
import { FormulaRegistry, setFormulaRegistry } from '../../src/core/formula';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setQueueInstance } from '../../src/core/queue';
import { setPearlsInstance } from '../../src/core/pearls';
import { setGlobalSingleton, clearGlobalSingleton } from '../../src/core/registry';
import { CONFIG_KEY } from '../../src/config';
import type { CitadelConfig } from '../../src/config/schema';

// Mock Config
const MOCK_CONFIG: CitadelConfig = {
    env: 'development',
    providers: {
        openai: { apiKey: 'mock' },
        ollama: { baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' }
    },
    agents: {
        worker: { model: 'mock', provider: 'openai' },
        gatekeeper: { model: 'mock', provider: 'openai' }
    },
    pearls: { path: '.pearls', binary: 'prl', autoSync: false },
    worker: { min_workers: 1, max_workers: 1, load_factor: 1, timeout: 300, maxRetries: 1, costLimit: 1 },
    gatekeeper: {
        min_workers: 1, max_workers: 1, load_factor: 1,
        auto_close_epics: true
    },
    bridge: { maxLogs: 100 },
    mcpServers: {},
    context: {
        maxHistoryMessages: 20,
        maxToolResponseSize: 50000,
        maxMessageSize: 100000,
        offloadThresholds: {}
    }
};

const TEST_DIR = resolve(process.cwd(), '.test_ddp');
const DB_PATH = resolve(TEST_DIR, 'queue.sqlite');
const FORMULAS_DIR = resolve(TEST_DIR, '.citadel/formulas');

// Reuse MockPearlsClient logic (simplified inline for this file to avoid complex imports if not exported)
class MockPearlsClient extends PearlsClient {
    public store: Map<string, any> = new Map();

    protected override async runCommand(args: string[]): Promise<string> {
        const cmd = args[0];

        // Create
        if (cmd === 'create') {
            const title = args[1] || 'Untitled';
            const id = `pearl-${Math.random().toString(36).substr(2, 9)}`;
            const pearl: any = {
                id, title, status: 'open', priority: 2,
                description: '', labels: [], metadata: {}, links: [],
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            const descIdx = args.indexOf('--description');
            if (descIdx !== -1 && args[descIdx + 1]) {
                pearl.description = args[descIdx + 1];
            }
            this.store.set(id, pearl);
            return JSON.stringify(pearl);
        }

        // Meta Set
        if (cmd === 'meta' && args[1] === 'set') {
            const id = args[2];
            const key = args[3];
            const value = JSON.parse(args[4]);
            const pearl = this.store.get(id);
            if (pearl) {
                if (!pearl.metadata) pearl.metadata = {};
                pearl.metadata[key] = value;
                this.store.set(id, pearl);
            }
            return JSON.stringify({ status: 'ok' });
        }

        // Update
        if (cmd === 'update') {
            const id = args[1];
            let pearl = this.store.get(id);
            if (!pearl) throw new Error('Not found');
            pearl = { ...pearl };
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--add-label' && args[i + 1]) {
                    if (!pearl.labels.includes(args[i + 1])) pearl.labels.push(args[i + 1]);
                }
                if (args[i] === '--remove-label' && args[i + 1]) {
                    pearl.labels = pearl.labels.filter((l: any) => l !== args[i + 1]);
                }
                if (args[i] === '--status' && args[i + 1]) {
                    const s = args[i + 1];
                    if (s === 'closed') pearl.status = 'closed';
                    else if (s === 'in_progress') pearl.status = 'in_progress';
                    else if (s === 'open') pearl.status = 'open';
                }
                if (args[i] === '--description' && args[i + 1]) {
                    pearl.description = args[i + 1];
                }
            }
            this.store.set(id, pearl);
            return JSON.stringify(pearl);
        }

        // Link
        if (cmd === 'link') {
            const childId = args[1];
            const parentId = args[2];
            const type = args[3] || 'blocks';
            const child = this.store.get(childId);
            if (child) {
                child.links = child.links || [];
                child.links.push({ target_id: parentId, link_type: type });
                this.store.set(childId, child);
            }
            return JSON.stringify({ status: 'ok' });
        }

        // Show
        if (cmd === 'show') {
            return JSON.stringify(this.store.get(args[1]));
        }

        // List
        if (cmd === 'list') {
            return JSON.stringify(Array.from(this.store.values()));
        }

        return '';
    }

    override async init() { }
}

describe('Dynamic Data Piping', () => {
    let pearls: MockPearlsClient;
    let queue: WorkQueue;
    let engine: WorkflowEngine;
    let piper: DataPiper;

    beforeEach(async () => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
        mkdirSync(FORMULAS_DIR, { recursive: true });

        // Fix: Set env var for AI SDK
        process.env.OPENAI_API_KEY = 'mock';

        setGlobalSingleton(CONFIG_KEY, MOCK_CONFIG);

        pearls = new MockPearlsClient(TEST_DIR);
        await pearls.init();

        queue = new WorkQueue(DB_PATH);
        setQueueInstance(queue);

        const registry = new FormulaRegistry(FORMULAS_DIR);
        // Important: set global singleton so WorkerAgent picks it up
        setFormulaRegistry(registry);

        engine = new WorkflowEngine(registry, pearls);
        piper = new DataPiper(pearls); // Uses getPearls(), getQueue()
    });

    afterEach(() => {
        if (queue) queue.close();
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
        clearGlobalSingleton('pearls_client');
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
        engine = new WorkflowEngine(registry, pearls);

        // 2. Instantiate Molecule
        const rootId = await engine.instantiateFormula('ddp_test', {});

        // Find Pearl IDs
        // Iterate store to find pearls by title roughly
        let producerId = '';
        let consumerId = '';

        for (const [id, pearl] of pearls.store.entries()) {
            if (pearl.title === 'Produce Data') producerId = id;
            if (pearl.title === 'Consume Data') consumerId = id;
        }

        expect(producerId).toBeTruthy();
        expect(consumerId).toBeTruthy();

        // 3. Verify Labels
        const producer = await pearls.get(producerId);
        expect(producer.labels).toContain('step:producer');
        expect(producer.labels).toContain('formula:ddp_test');

        // 4. Run Worker on Producer (Verify Schema)
        // Set queue ticket
        queue.enqueue(producerId, 1, 'worker');
        queue.claim('w1', 'worker');

        // Use cache-busting dynamic import to bypass potential mock leaks
        const { WorkerAgent } = await import('../../src/agents/worker');
        const worker = new WorkerAgent(undefined, pearls);

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
        await worker.run('Work', { pearlId: producerId });

        // Verify Schema manually
        const submitTool = (worker as any).dynamicTools['submit_work'] || (worker as any).tools['submit_work'];
        const schema = submitTool.inputSchema;
        // Check for magic_number in schema
        // Schema is ZodObject.
        // We can check strictness by seeing if it accepts valid data and rejects invalid.

        // 1. Valid Execution
        // Manually move pearl to in_progress so submit_work can move it to verify
        await pearls.update(producerId, { status: 'in_progress' });

        const validArgs = {
            summary: 'Done',
            output: { magic_number: 42 }
        };
        await submitTool.execute(validArgs, { toolCallId: 'test', messages: [], pearlId: producerId } as any);

        let outputTicket = queue.getOutput(producerId);
        expect(outputTicket).toEqual({ magic_number: 42 });

        // 2. Invalid Execution (Missing required field)
        const invalidArgs = {
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

        const consumer = await pearls.get(consumerId);
        // "input_num": "{{steps.producer.output.magic_number}}" -> 42
        // Note: My Piper implementation returns explicit value from output. 
        // 42 is proper number if replacement logic handles specific typing or full replacement.
        // Current logic: `return await this.fetchValue(...)` in `resolveTemplate`.
        // `resolveObject` calls `resolveTemplate`.
        // If template matches full string, exact value is used.
        const consumerRefreshed = await pearls.get(consumerId);
        expect(consumerRefreshed.context?.input_num).toBe(42);
    });
});
