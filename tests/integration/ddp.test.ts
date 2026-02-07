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
        router: { model: 'mock', provider: 'openai' },
        gatekeeper: { model: 'mock', provider: 'openai' }
    },
    pearls: { path: '.pearls', binary: 'prl', autoSync: false },
    worker: { min_workers: 1, max_workers: 1, load_factor: 1, timeout: 300, maxRetries: 1, costLimit: 1 },
    gatekeeper: { min_workers: 1, max_workers: 1, load_factor: 1 },
    bridge: { maxLogs: 100 },
    mcpServers: {},
    context: {
        maxHistoryMessages: 20,
        maxToolResponseSize: 50000,
        maxMessageSize: 100000
    }
};

const TEST_DIR = resolve(process.cwd(), '.test_ddp');
const DB_PATH = resolve(TEST_DIR, 'queue.sqlite');
const FORMULAS_DIR = resolve(TEST_DIR, '.citadel/formulas');

// Reuse MockPearlsClient logic (simplified inline for this file to avoid complex imports if not exported)
class MockPearlsClient extends PearlsClient {
    public store: Map<string, any> = new Map();

    protected override async runCommand(args: string): Promise<string> {
        // console.log(`[MockPearlsClient] runCommand: ${args}`);
        // Create
        if (args.startsWith('create')) {
            const titleMatch = args.match(/create "([^"]+)"/);
            const title = titleMatch ? titleMatch[1] : 'Untitled';

            const id = `pearl-${Math.random().toString(36).substr(2, 9)}`;

            const pearl: any = {
                id, title, status: 'open', priority: 2,
                description: '', labels: [], metadata: {}, links: [],
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            this.store.set(id, pearl);
            return JSON.stringify(pearl);
        }

        // Meta Set
        if (args.startsWith('meta set')) {
            const parts = args.split(' ');
            const id = parts[2];
            const key = parts[3];
            let valueStr = args.substring(args.indexOf(key) + key.length + 1);
            if (valueStr.includes('--format')) {
                valueStr = valueStr.substring(0, valueStr.indexOf('--format')).trim();
            }
            if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
                valueStr = valueStr.substring(1, valueStr.length - 1);
            }
            const value = JSON.parse(valueStr.replace(/\\"/g, '"'));
            const pearl = this.store.get(id);
            if (pearl) {
                if (!pearl.metadata) pearl.metadata = {};
                pearl.metadata[key] = value;
                this.store.set(id, pearl);
            }
            return JSON.stringify({ status: 'ok' });
        }

        // Update
        if (args.startsWith('update')) {
            const idPart = args.split(' ')[1];
            if (!idPart) throw new Error('Missing ID');
            let pearl = this.store.get(idPart);
            if (!pearl) throw new Error('Not found');

            pearl = { ...pearl };
            if (!pearl.labels) pearl.labels = [];

            // Handle labels
            if (args.includes('--add-label')) {
                const parts = args.split(' ');
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] === '--add-label' && parts[i + 1]) {
                        const rawLabel = parts[i + 1];
                        if (rawLabel) {
                            const label = rawLabel.replace(/^"|"$/g, '');
                            if (!pearl.labels.includes(label)) {
                                pearl.labels.push(label);
                            }
                        }
                    }
                }
            }

            // Handle description update
            const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
            if (descMatch && descMatch[1]) {
                pearl.description = descMatch[1].replace(/\\"/g, '"');
            }

            // Handle status
            if (args.includes('--status closed')) pearl.status = 'closed';
            else if (args.includes('--status in_progress')) pearl.status = 'in_progress';
            else if (args.includes('--status verify')) pearl.status = 'verify'; // Simplified for mock

            this.store.set(idPart, pearl);
            return JSON.stringify(pearl);
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

        // Link (Pearls dep add replacement)
        if (args.startsWith('link')) {
            const parts = args.split(' ');
            if (parts.length >= 4) {
                const child = parts[1];
                const parent = parts[2];
                if (child && parent) {
                    const c = this.store.get(child);
                    if (c) {
                        c.links = c.links || [];
                        c.links.push({ target_id: parent, link_type: parts[3] || 'blocks' });
                        this.store.set(child, c);
                    }
                }
                return JSON.stringify({ status: 'ok' });
            }
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
        setPearlsInstance(pearls);

        queue = new WorkQueue(DB_PATH);
        setQueueInstance(queue);

        const registry = new FormulaRegistry(FORMULAS_DIR);
        // Important: set global singleton so WorkerAgent picks it up
        setFormulaRegistry(registry);

        engine = new WorkflowEngine(registry);
        piper = new DataPiper(); // Uses getPearls(), getQueue()
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
        engine = new WorkflowEngine(registry);

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
