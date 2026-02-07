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
        router: { model: 'mock-model', provider: 'openai' },
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
        min_workers: 1, max_workers: 2, load_factor: 1
    },
    bridge: { maxLogs: 1000 },
    mcpServers: {},
    context: {
        maxHistoryMessages: 20,
        maxToolResponseSize: 50000,
        maxMessageSize: 100000
    }
};

const TEST_DIR = resolve(process.cwd(), '.test_data_flow');
const DB_PATH = resolve(TEST_DIR, 'queue.sqlite');

// Mock PearlsClient to simulate CLI behavior without 'bd' binary
class MockPearlsClient extends PearlsClient {
    private pearls: Map<string, any> = new Map();

    protected override async runCommand(args: string): Promise<string> {
        console.log(`[Mock] runCommand: ${args}`);
        if (args.startsWith('create')) {
            const titleMatch = args.match(/create "([^"]+)"/);
            const title = titleMatch ? titleMatch[1] : 'Untitled';

            let description = '';
            const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
            if (descMatch && descMatch[1]) {
                description = descMatch[1].replace(/\\"/g, '"');
            }

            const id = `pearl-${Math.random().toString(36).substr(2, 9)}`;
            const pearl: any = {
                id,
                title,
                status: 'open',
                priority: 2,
                description,
                labels: [],
                metadata: {},
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            this.pearls.set(id, pearl);
            console.log(`[Mock] Created pearl ${id}`);
            return JSON.stringify(pearl);
        }

        if (args.startsWith('show')) {
            const id = args.split(' ')[1];
            if (!id) throw new Error('Missing ID');
            const pearl = this.pearls.get(id);
            if (!pearl) throw new Error('Not found');
            return JSON.stringify(pearl);
        }

        if (args.startsWith('meta set')) {
            const parts = args.split(' ');
            const id = parts[2];
            const key = parts[3];
            let valueStr = args.substring(args.indexOf(key) + key.length + 1);
            if (valueStr.includes('--format')) {
                valueStr = valueStr.substring(0, valueStr.indexOf('--format')).trim();
            }
            console.log(`[Mock] Meta set: id=${id}, key=${key}, rawValue=${valueStr}`);
            if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
                valueStr = valueStr.substring(1, valueStr.length - 1);
            }
            // Value is JSON stringified and escaped
            try {
                const value = JSON.parse(valueStr.replace(/\\"/g, '"'));
                console.log(`[Mock] Parsed meta value:`, value);

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

        if (args.startsWith('update')) {
            const id = args.split(' ')[1];
            if (!id) throw new Error('Missing ID');
            console.log(`[Mock] Updating pearl ${id} with args: ${args}`);
            let pearl: any = this.pearls.get(id);
            if (!pearl) throw new Error('Not found ' + id);

            pearl = { ...pearl };
            if (!pearl.labels) pearl.labels = [];

            if (args.includes('--status closed')) {
                pearl.status = 'closed';
            }
            else if (args.includes('--add-label verify')) {
                pearl.status = 'in_progress';
                if (!pearl.labels.includes('verify')) pearl.labels.push('verify');
                console.log(`[Mock] Status set to in_progress + verify label`);
            }
            else if (args.includes('--remove-label verify')) {
                if (args.includes('--status in_progress')) pearl.status = 'in_progress';
                if (args.includes('--status open')) pearl.status = 'open';
                pearl.labels = pearl.labels.filter((l: string) => l !== 'verify');
                console.log(`[Mock] Status set to ${pearl.status} (verify removed)`);
            }
            else if (args.includes('--status in_progress')) {
                pearl.status = 'in_progress';
            }

            if (args.includes('--description')) {
                const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
                if (descMatch && descMatch[1]) {
                    pearl.description = descMatch[1].replace(/\\"/g, '"');
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
        setPearlsInstance(pearls);

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
        const agent = new WorkerAgent();
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
