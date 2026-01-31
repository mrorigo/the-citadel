
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { Hook } from '../../src/core/hooks';

// 1. Mock WorkerPool BEFORE importing Conductor
// This needs to be a "hoisted" mock or ensure require happens after
let capturedGatekeeperFactory: ((id: string) => Hook) | null = null;

mock.module('../../src/core/pool', () => {
    return {
        WorkerPool: class {
            constructor(role: string, factory: (id: string) => Hook) {
                if (role === 'gatekeeper') {
                    capturedGatekeeperFactory = factory;
                }
            }
            start() { }
            stop() { }
            resize() { }
        }
    };
});

// 2. Mock EvaluatorAgent
const mockRun = mock(async () => 'mock-response');
mock.module('../../src/agents/evaluator', () => {
    return {
        EvaluatorAgent: class {
            run = mockRun;
        }
    };
});

// 3. Now import Conductor
import { Conductor } from '../../src/services/conductor';
import { setBeadsInstance, type BeadsClient, type Bead } from '../../src/core/beads';
import { setQueueInstance, type WorkQueue, type Ticket } from '../../src/core/queue';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';

describe('Gatekeeper Context Integration', () => {
    let conductor: Conductor;
    let mockBeads: Partial<BeadsClient>;
    let mockQueue: Partial<WorkQueue>;

    afterAll(() => {
        mock.restore();
    });

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');

        mockRun.mockClear();
        capturedGatekeeperFactory = null;

        mockBeads = {
            get: mock(async (id) => ({
                id,
                title: 'Test Task',
                status: 'verify',
                created_at: '',
                updated_at: '',
                priority: 1
            } as unknown as Bead)),
            update: mock(async () => ({} as Bead)),
            doctor: mock(async () => true),
        } as unknown as Partial<BeadsClient>;

        mockQueue = {
            getOutput: mock((id) => {
                if (id === 'bead-1') return { summary: 'Real Work', data: 'foo' };
                return null;
            }),
            getActiveTicket: mock(() => null),
            getPendingCount: mock(() => 0),
            claim: mock(() => null), // Safety mock
            complete: mock(() => { })
        } as unknown as Partial<WorkQueue>;

        setBeadsInstance(mockBeads as BeadsClient);
        setQueueInstance(mockQueue as WorkQueue);
    });

    it('should pass persisted output to EvaluatorAgent', async () => {
        // Instantiate Conductor to trigger Pool creation (which we mocked)
        conductor = new Conductor(mockBeads as BeadsClient, mockQueue as WorkQueue);

        expect(capturedGatekeeperFactory).toBeFunction();

        // Instantiate the Hook via the captured factory
        // The factory returns a Hook instance (real Hook class, but we don't start it)
        const hook = capturedGatekeeperFactory!('agent-1');

        // Extract the private handler
        const handler = (hook as any).handler;
        expect(handler).toBeFunction();

        // Run the handler manually with a dummy ticket
        // The ticket.output is NULL here (mimicking reality)
        const ticket: Ticket = {
            id: 'ticket-1',
            bead_id: 'bead-1',
            status: 'processing',
            priority: 1,
            target_role: 'gatekeeper',
            assignee_id: 'agent-1',
            created_at: 0,
            started_at: 0,
            completed_at: 0,
            heartbeat_at: 0,
            retry_count: 0,
            output: null
        };

        await handler(ticket);

        // Assert that EvaluatorAgent.run was called
        expect(mockRun).toHaveBeenCalled();
        const args = mockRun.mock.lastCall?.[1] as any;
        expect(args).toBeDefined();

        // CRITICAL: Verify submitted_work came from getOutput()
        expect(args.submitted_work).toEqual({ summary: 'Real Work', data: 'foo' });
    });
});
