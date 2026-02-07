import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import { PearlsClient, setPearlsInstance } from '../../src/core/pearls';
import { WorkQueue, setQueueInstance } from '../../src/core/queue';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setConfig, resetConfig } from '../../src/config';
import { clearGlobalSingleton } from '../../src/core/registry';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Setup test env
const TEST_ENV = join(process.cwd(), `tests/temp_deadlock_${Date.now()}`);
const TEST_PEARLS_PATH = join(TEST_ENV, '.pearls');
const TEST_QUEUE_PATH = join(TEST_ENV, 'queue.sqlite');

describe('Deadlock Reproduction', () => {
    let conductor: Conductor;
    let pearlsClient: PearlsClient;
    let queue: WorkQueue;

    beforeEach(async () => {
        await rm(TEST_ENV, { recursive: true, force: true }).catch(() => { });
        await mkdir(TEST_ENV, { recursive: true });

        // Pearls requires git repo
        await execAsync('git init', { cwd: TEST_ENV });

        await mkdir(TEST_PEARLS_PATH, { recursive: true });

        pearlsClient = new PearlsClient(TEST_PEARLS_PATH);
        await pearlsClient.init();
        setPearlsInstance(pearlsClient);

        queue = new WorkQueue(TEST_QUEUE_PATH);
        setQueueInstance(queue);

        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            },
            pearls: { path: TEST_PEARLS_PATH },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 }
        });

        conductor = new Conductor(pearlsClient, queue);
    });

    afterEach(async () => {
        if (conductor) conductor.stop();
        if (queue) queue.close();
        await rm(TEST_ENV, { recursive: true, force: true }).catch(() => { });
    });

    afterAll(() => {
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
    });

    it('should NOT block child task when parent is an epic', async () => {
        // 1. Create Parent Epic
        const epic = await pearlsClient.create('My Epic', { type: 'epic' });
        expect(epic.status).toBe('open');

        // 2. Create Child Task
        const task = await pearlsClient.create('My Child Task', { parent: epic.id });
        expect(task.status).toBe('open');

        // 3. Verify Dependencies (in domain object)
        const freshTask = await pearlsClient.get(task.id);

        // If 'parent-child' is mapped to 'blockers', this will be true
        console.log('Task blockers:', freshTask.blockers);
        console.log('Task parent:', freshTask.parent);

        // 4. Run Conductor Cycle (simulate)
        // Access private method or just run logic here to see if it would skip

        const readyPearls = await pearlsClient.ready();
        const readyTask = readyPearls.find(b => b.id === task.id);

        // BD CLI might say it's ready (if it ignores parent-child for ready list)
        console.log('Is task in ready list?', !!readyTask);

        if (readyTask) {
            // Mimic Conductor check - it uses FRESH pearl
            const fresh = await pearlsClient.get(readyTask.id);
            if (fresh.blockers && fresh.blockers.length > 0) {
                const blockers = await Promise.all(fresh.blockers.map(id => pearlsClient.get(id)));
                const activeBlockers = blockers.filter(b => b.status !== 'done');

                console.log('Active blockers for task:', activeBlockers.map(b => b.id));
                expect(activeBlockers.length).toBe(0); // Should be 0 for it to run!
            }
        } else {
            console.log('Task not even in ready list!');
        }
    });
});
