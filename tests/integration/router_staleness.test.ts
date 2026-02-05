
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import { BeadsClient } from '../../src/core/beads';
import { WorkQueue } from '../../src/core/queue';
import { setBeadsInstance } from '../../src/core/beads';
import { setQueueInstance } from '../../src/core/queue';
import { clearGlobalSingleton } from '../../src/core/registry';
import { setConfig, resetConfig } from '../../src/config';

describe('Router Staleness Detection', () => {
    let conductor: Conductor;
    let mockBeads: any;
    let mockQueue: any;

    beforeEach(() => {
        mockBeads = {
            ready: mock(async () => []),
            list: mock(async (status) => []),
            get: mock(async (id) => ({ id, status: 'open' })),
            update: mock(async () => ({})),
            doctor: mock(async () => true),
        };

        mockQueue = {
            getActiveTicket: mock(() => null),
            getLatestTicket: mock(() => null),
            getPendingCount: mock(() => 0),
        };

        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.beads' },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 },
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' },
                supervisor: { provider: 'ollama', model: 'mock' }
            }
        });

        conductor = new Conductor(mockBeads, mockQueue);
        setBeadsInstance(mockBeads);
        setQueueInstance(mockQueue);
    });

    afterEach(() => {
        conductor.stop();
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        resetConfig();
    });

    it('should NOT reset bead if ticket was recently completed (Grace Period)', async () => {
        const beadId = 'test-bead';

        mockBeads.list.mockImplementation(async (status: string) => {
            if (status === 'in_progress') return [{ id: beadId, status: 'in_progress' }];
            return [];
        });

        mockQueue.getActiveTicket.mockReturnValue(null);
        mockQueue.getLatestTicket.mockReturnValue({
            id: 'ticket-1',
            status: 'completed',
            completed_at: Date.now() - 1000 // 1s ago
        });

        // @ts-ignore
        conductor.isRunning = true;
        // @ts-ignore
        await conductor.cycleRouter();

        const calls = mockBeads.update.mock.calls;
        const resetCall = calls.find((c: any) => c[0] === beadId && c[1].status === 'open');
        expect(resetCall).toBeUndefined();
    });

    it('should reset bead if grace period has expired', async () => {
        const beadId = 'stale-bead';

        mockBeads.list.mockImplementation(async (status: string) => {
            if (status === 'in_progress') return [{ id: beadId, status: 'in_progress' }];
            return [];
        });

        mockQueue.getActiveTicket.mockReturnValue(null);
        mockQueue.getLatestTicket.mockReturnValue({
            id: 'ticket-1',
            status: 'completed',
            completed_at: Date.now() - 6000 // 6s ago
        });

        // @ts-ignore
        conductor.isRunning = true;
        // @ts-ignore
        await conductor.cycleRouter();

        const calls = mockBeads.update.mock.calls;
        const resetCall = calls.find((c: any) => c[0] === beadId && c[1].status === 'open');
        expect(resetCall).toBeDefined();
    });
});
