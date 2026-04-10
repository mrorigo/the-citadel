import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PearlsClient, type Pearl, type PearlStatus } from '../../src/core/pearls';
import { WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setQueueInstance } from '../../src/core/queue';
import { setPearlsInstance } from '../../src/core/pearls';
import { setGlobalSingleton } from '../../src/core/registry';
import { CONFIG_KEY } from '../../src/config';
import type { CitadelConfig } from '../../src/config/schema';

// Mock Config
const MOCK_CONFIG: CitadelConfig = {
    env: 'development',
    providers: {
        openai: { apiKey: 'mock' },
        anthropic: { apiKey: 'mock' },
        ollama: { baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' }
    },
    agents: {
        worker: { model: 'mock-model', provider: 'openai' },
        gatekeeper: { model: 'mock-model', provider: 'openai' }
    },
    pearls: {
        path: '.pearls',
        binary: 'prl',
        autoSync: false
    },
    worker: {
        min_workers: 1, max_workers: 2, load_factor: 1,
        timeout: 300, maxRetries: 3, costLimit: 1
    },
    gatekeeper: {
        min_workers: 1, max_workers: 2, load_factor: 1,
        auto_close_epics: true
    },
    bridge: { maxLogs: 1000 },
    mcpServers: {},
    context: {
        maxHistoryMessages: 20,
        maxToolResponseSize: 50000,
        maxMessageSize: 100000,
        offloadThresholds: {}
    }
};

const TEST_DIR = resolve(process.cwd(), '.test_data_flow');
const DB_PATH = resolve(TEST_DIR, 'queue.sqlite');

// Mock PearlsClient to simulate CLI behavior without 'bd' binary
class MockPearlsClient extends PearlsClient {
    private pearls: Map<string, any> = new Map();

    public override async runCommand(args: string[]): Promise<string> {
        const cmd = args[0];
        console.log(`[Mock] runCommand: ${args.join(" ")}`);

        if (cmd === 'create') {
            const title = args[1] || 'Untitled';
            let description = '';
            const descIdx = args.indexOf('--description');
            if (descIdx !== -1 && args[descIdx + 1]) {
                description = args[descIdx + 1];
            }

            const id = `pearl-${Math.random().toString(36).substr(2, 9)}`;
            const pearl: any = {
                id, title, status: 'open', priority: 2,
                description, labels: [], metadata: {},
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            this.pearls.set(id, pearl);
            console.log(`[Mock] Created pearl ${id}`);
            return JSON.stringify(pearl);
        }

        if (cmd === 'show') {
            const id = args[1];
            const pearl = this.pearls.get(id);
            if (!pearl) throw new Error('Not found');
            return JSON.stringify(pearl);
        }

        if (cmd === 'meta' && args[1] === 'set') {
            const id = args[2];
            const key = args[3];
            const valueStr = args[4];
            console.log(`[Mock] Meta set: id=${id}, key=${key}, rawValue=${valueStr}`);
            try {
                const value = JSON.parse(valueStr);
                const pearl = this.pearls.get(id);
                if (pearl) {
                    if (!pearl.metadata) pearl.metadata = {};
                    pearl.metadata[key] = value;
                    this.pearls.set(id, pearl);
                    console.log(`[Mock] Updated pearl ${id} metadata`);
                }
            } catch (e) {
                console.error(`[Mock] Failed to parse meta value: ${valueStr}`, e);
            }
            return JSON.stringify({ status: 'ok' });
        }

        if (cmd === 'update') {
            const id = args[1];
            let pearl: any = this.pearls.get(id);
            if (!pearl) throw new Error('Not found ' + id);

            pearl = { ...pearl };
            if (!pearl.labels) pearl.labels = [];

            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--status' && args[i + 1]) {
                    const s = args[i + 1];
                    if (s === 'closed') pearl.status = 'closed';
                    else if (s === 'in_progress') pearl.status = 'in_progress';
                }
                if (args[i] === '--add-label' && args[i + 1]) {
                    const label = args[i + 1];
                    if (!pearl.labels.includes(label)) pearl.labels.push(label);
                    if (label === 'verify') pearl.status = 'in_progress';
                }
                if (args[i] === '--remove-label' && args[i + 1]) {
                    const label = args[i + 1];
                    pearl.labels = pearl.labels.filter((l: any) => l !== label);
                    if (label === 'verify') pearl.status = 'in_progress';
                }
                if (args[i] === '--description' && args[i + 1]) {
                    pearl.description = args[i + 1];
                }
            }

            this.pearls.set(id, pearl);
            return JSON.stringify(pearl);
        }

        return '';
    }

    override async init() { }
}

describe('Data Flow Integration', () => {
    let pearls: PearlsClient;
    let queue: WorkQueue;

    beforeEach(async () => {
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }

        // Inject Mock Config
        setGlobalSingleton(CONFIG_KEY, MOCK_CONFIG);

        pearls = new MockPearlsClient(TEST_DIR);
        await pearls.init();

        queue = new WorkQueue(DB_PATH);
        setQueueInstance(queue);
    });

    afterEach(() => {
        if (queue) queue.close();
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
    });

    it('should persist context in pearl description and parse it back', async () => {
        const context = {
            query: 'test query',
            depth: 2,
            tags: ['ai', 'agent']
        };

        const pearl = await pearls.create('Context Test Pearl', {
            description: 'This is a test pearl',
            context
        });

        // 1. Verify description format
        expect(pearl.description).toBe('This is a test pearl');
        expect(pearl.context).toEqual(context);

        // 2. Fetch fresh and verify parsing
        const fresh = await pearls.get(pearl.id);
        expect(fresh.context).toEqual(context);
        expect(fresh.description).toBe('This is a test pearl');
    });

    it('should save structured output from worker agent', async () => {
        // 1. Create a task
        const pearl = await pearls.create('Output Test Pearl');

        // 2. Enqueue it
        queue.enqueue(pearl.id, 1, 'worker');

        // 3. Claim it 
        const ticket = queue.claim('test-worker-id', 'worker');
        expect(ticket).not.toBeNull();
        if (ticket) {
            expect(ticket.pearl_id).toBe(pearl.id);
        }

        // 4. Run Worker Agent Tool (submit_work)
        // Use cache-busting dynamic import to bypass potential mock leaks
        const { WorkerAgent } = await import('../../src/agents/worker');
        const agent = new WorkerAgent("worker", undefined, pearls);
        // Access protected tools via any cast
        const tools = (agent as any).tools;
        const submitTool = tools['submit_work'];
        expect(submitTool).toBeDefined();

        const outputData = "Job finished successfully";

        // Transition to in_progress first to satisfy state machine
        await pearls.update(pearl.id, { status: 'in_progress' });

        // Execute tool directly
        await submitTool.execute({
            summary: 'Job done',
            output: outputData
        }, { toolCallId: 'call-1', messages: [], pearlId: pearl.id } as any);

        // 5. Verify Queue State
        const completedTicket = queue.getOutput(pearl.id);
        expect(completedTicket).toEqual(outputData);

        // Verify status
        const freshPearl = await pearls.get(pearl.id);
        expect(freshPearl.status).toBe('verify');
    });
});
