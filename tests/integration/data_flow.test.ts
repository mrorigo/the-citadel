import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BeadsClient, type Bead, type BeadStatus } from '../../src/core/beads';
import { WorkQueue } from '../../src/core/queue';
import { setFormulaRegistry } from '../../src/core/formula';
import { clearGlobalSingleton } from '../../src/core/registry';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setQueueInstance } from '../../src/core/queue';
import { setBeadsInstance } from '../../src/core/beads';
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
    beads: {
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

// Mock BeadsClient to simulate CLI behavior without 'bd' binary
class MockBeadsClient extends BeadsClient {
    private beads: Map<string, any> = new Map();

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

            const id = `bead-${Math.random().toString(36).substr(2, 9)}`;
            const bead: any = {
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
            this.beads.set(id, bead);
            console.log(`[Mock] Created bead ${id}`);
            return JSON.stringify(bead);
        }

        if (args.startsWith('show')) {
            const id = args.split(' ')[1];
            if (!id) throw new Error('Missing ID');
            const bead = this.beads.get(id);
            if (!bead) throw new Error('Not found');
            return JSON.stringify(bead);
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

                const bead = this.beads.get(id);
                if (bead) {
                    if (!bead.metadata) bead.metadata = {};
                    bead.metadata[key] = value;
                    this.beads.set(id, bead);
                    console.log(`[Mock] Updated bead ${id} metadata`);
                }
            } catch (e) {
                console.error(`[Mock] Failed to parse meta value: ${valueStr}`, e);
            }
            return JSON.stringify({ status: 'ok' });
        }

        if (args.startsWith('update')) {
            const id = args.split(' ')[1];
            if (!id) throw new Error('Missing ID');
            console.log(`[Mock] Updating bead ${id} with args: ${args}`);
            let bead: any = this.beads.get(id);
            if (!bead) throw new Error('Not found ' + id);

            bead = { ...bead };
            if (!bead.labels) bead.labels = [];

            if (args.includes('--status closed')) {
                bead.status = 'closed';
            }
            else if (args.includes('--add-label verify')) {
                bead.status = 'in_progress';
                if (!bead.labels.includes('verify')) bead.labels.push('verify');
                console.log(`[Mock] Status set to in_progress + verify label`);
            }
            else if (args.includes('--remove-label verify')) {
                if (args.includes('--status in_progress')) bead.status = 'in_progress';
                if (args.includes('--status open')) bead.status = 'open';
                bead.labels = bead.labels.filter((l: string) => l !== 'verify');
                console.log(`[Mock] Status set to ${bead.status} (verify removed)`);
            }
            else if (args.includes('--status in_progress')) {
                bead.status = 'in_progress';
            }

            if (args.includes('--description')) {
                const descMatch = args.match(/--description "((?:[^"\\]|\\.)*)"/);
                if (descMatch && descMatch[1]) {
                    bead.description = descMatch[1].replace(/\\"/g, '"');
                }
            }

            this.beads.set(id, bead);
            return JSON.stringify(bead);
        }

        return '';
    }

    override async init() { }
}

describe('Data Flow Integration', () => {
    let beads: BeadsClient;
    let queue: WorkQueue;

    beforeEach(async () => {
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }

        // Inject Mock Config
        setGlobalSingleton(CONFIG_KEY, MOCK_CONFIG);

        beads = new MockBeadsClient(TEST_DIR);
        await beads.init();
        setBeadsInstance(beads);

        queue = new WorkQueue(DB_PATH);
        setQueueInstance(queue);
    });

    afterEach(() => {
        if (queue) queue.close();
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
    });

    it('should persist context in bead description and parse it back', async () => {
        const context = {
            query: 'test query',
            depth: 2,
            tags: ['ai', 'agent']
        };

        const bead = await beads.create('Context Test Bead', {
            description: 'This is a test bead',
            context
        });

        // 1. Verify description format
        expect(bead.description).toBe('This is a test bead');
        expect(bead.context).toEqual(context);

        // 2. Fetch fresh and verify parsing
        const fresh = await beads.get(bead.id);
        expect(fresh.context).toEqual(context);
        expect(fresh.description).toBe('This is a test bead');
    });

    it('should save structured output from worker agent', async () => {
        // 1. Create a task
        const bead = await beads.create('Output Test Bead');

        // 2. Enqueue it
        queue.enqueue(bead.id, 1, 'worker');

        // 3. Claim it 
        const ticket = queue.claim('test-worker-id', 'worker');
        expect(ticket).not.toBeNull();
        if (ticket) {
            expect(ticket.bead_id).toBe(bead.id);
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
        await beads.update(bead.id, { status: 'in_progress' });

        // Execute tool directly
        await submitTool.execute({
            summary: 'Job done',
            output: outputData
        }, { toolCallId: 'call-1', messages: [], beadId: bead.id } as any);

        // 5. Verify Queue State
        const completedTicket = queue.getOutput(bead.id);
        expect(completedTicket).toEqual(outputData);

        // Verify status
        const freshBead = await beads.get(bead.id);
        expect(freshBead.status).toBe('verify');
    });
});
