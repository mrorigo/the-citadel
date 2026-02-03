import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import { BeadsClient, setBeadsInstance } from '../../src/core/beads';
import { WorkQueue, setQueueInstance } from '../../src/core/queue';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setConfig } from '../../src/config';

// Setup test env
const TEST_ENV = join(process.cwd(), `tests/temp_deadlock_${Date.now()}`);
const TEST_BEADS_PATH = join(TEST_ENV, '.beads');
const TEST_QUEUE_PATH = join(TEST_ENV, 'queue.sqlite');

describe('Deadlock Reproduction', () => {
    let conductor: Conductor;
    let beadsClient: BeadsClient;
    let queue: WorkQueue;

    beforeEach(async () => {
        await rm(TEST_ENV, { recursive: true, force: true }).catch(() => { });
        await mkdir(TEST_BEADS_PATH, { recursive: true });

        beadsClient = new BeadsClient(TEST_BEADS_PATH);
        await beadsClient.init();
        setBeadsInstance(beadsClient);

        queue = new WorkQueue(TEST_QUEUE_PATH);
        setQueueInstance(queue);

        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: { router: { provider: 'ollama', model: 'mock' }, worker: { provider: 'ollama', model: 'mock' }, gatekeeper: { provider: 'ollama', model: 'mock' }, supervisor: { provider: 'ollama', model: 'mock' } },
            beads: { path: TEST_BEADS_PATH },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 }
        });

        conductor = new Conductor(beadsClient, queue);
    });

    afterEach(async () => {
        if (conductor) conductor.stop();
        await rm(TEST_ENV, { recursive: true, force: true }).catch(() => { });
    });

    it('should NOT block child task when parent is an epic', async () => {
        // 1. Create Parent Epic
        const epic = await beadsClient.create('My Epic', { type: 'epic' });
        expect(epic.status).toBe('open');

        // 2. Create Child Task
        const task = await beadsClient.create('My Child Task', { parent: epic.id });
        expect(task.status).toBe('open');

        // 3. Verify Dependencies (in domain object)
        const freshTask = await beadsClient.get(task.id);

        // If 'parent-child' is mapped to 'blockers', this will be true
        console.log('Task blockers:', freshTask.blockers);
        console.log('Task parent:', freshTask.parent);

        // 4. Run Conductor Cycle (simulate)
        // Access private method or just run logic here to see if it would skip

        const readyBeads = await beadsClient.ready();
        const readyTask = readyBeads.find(b => b.id === task.id);

        // BD CLI might say it's ready (if it ignores parent-child for ready list)
        console.log('Is task in ready list?', !!readyTask);

        if (readyTask) {
            // Mimic Conductor check - it uses FRESH bead
            const fresh = await beadsClient.get(readyTask.id);
            if (fresh.blockers && fresh.blockers.length > 0) {
                const blockers = await Promise.all(fresh.blockers.map(id => beadsClient.get(id)));
                const activeBlockers = blockers.filter(b => b.status !== 'done');

                console.log('Active blockers for task:', activeBlockers.map(b => b.id));
                expect(activeBlockers.length).toBe(0); // Should be 0 for it to run!
            }
        } else {
            console.log('Task not even in ready list!');
        }
    });
});
