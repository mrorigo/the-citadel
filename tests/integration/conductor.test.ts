import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import type { Bead, BeadsClient } from '../../src/core/beads';
import type { WorkQueue } from '../../src/core/queue';

// Mock dependencies
const mockBeads = {
    list: mock(async (): Promise<Bead[]> => []),
    get: mock(async () => ({ id: 'mock-id', title: 'mock', status: 'open', created_at: '', updated_at: '', priority: 2 } as Bead)),
};

const mockQueue = {
    getActiveTicket: mock(() => null),
    enqueue: mock(() => { }),
    claim: mock(() => null),
    complete: mock(() => { }),
    fail: mock(() => { }),
    heartbeat: mock(() => { }),
};

const mockRouterAgent = {
    run: mock(async () => 'Mocked Plan'),
};

const mockWorkerAgent = {
    run: mock(async () => 'Mocked Work'),
};

// Mock modules
// Removed beads/queue module mocks in favor of DI


mock.module('../../src/agents/router', () => ({
    RouterAgent: mock(() => mockRouterAgent),
}));

mock.module('../../src/agents/worker', () => ({
    WorkerAgent: mock(() => mockWorkerAgent),
}));

mock.module('../../src/agents/evaluator', () => ({
    EvaluatorAgent: mock(() => mockWorkerAgent), // Reuse mock for simplicity
}));


describe('Conductor Service Integration', () => {
    let conductor: Conductor;

    beforeEach(() => {
        conductor = new Conductor(mockBeads as unknown as BeadsClient, mockQueue as unknown as WorkQueue);
    });

    afterEach(() => {
        conductor.stop();
        mock.restore(); // Restore mocks if needed, though module mocks persist
    });

    it('should route open beads to worker', async () => {
        // Setup state: 1 open bead, no active tickets
        mockBeads.list.mockResolvedValueOnce([{ id: 'bead-1', status: 'open', title: 'Task 1' } as Bead]);
        // Double-check logic needs get() to return "open"
        mockBeads.get.mockResolvedValueOnce({ id: 'bead-1', status: 'open', title: 'Task 1' } as Bead);

        mockQueue.getActiveTicket.mockReturnValue(null);

        // Start (triggers router loop)
        conductor.start();

        // Wait a bit for async loop
        await new Promise(r => setTimeout(r, 100));

        // Router agent should be called
        expect(mockRouterAgent.run).toHaveBeenCalled();
        const callArgs = mockRouterAgent.run.mock.calls[0] as unknown as [string, { beadId: string, status: string }];
        expect(callArgs[1]).toEqual({ beadId: 'bead-1', status: 'open' });

        conductor.stop();
    });

    it('should route verify beads to gatekeeper', async () => {
        // Setup state: 1 verify bead
        mockBeads.list.mockReset();
        mockBeads.list
            .mockResolvedValueOnce([]) // Open
            .mockResolvedValueOnce([{ id: 'bead-2', status: 'verify', title: 'Verify 1' } as Bead]); // Verify

        // Double-check logic needs get() to return "verify"
        mockBeads.get.mockResolvedValueOnce({ id: 'bead-2', status: 'verify', title: 'Verify 1' } as Bead);

        conductor.start();
        await new Promise(r => setTimeout(r, 100));

        expect(mockRouterAgent.run).toHaveBeenCalled();
        const callArgs = mockRouterAgent.run.mock.lastCall as unknown as [string, { beadId: string, status: string }];
        expect(callArgs[1]).toEqual({ beadId: 'bead-2', status: 'verify' });

        conductor.stop();
    });
});
