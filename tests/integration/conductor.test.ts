import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import type { Bead } from '../../src/core/beads';

// Mock dependencies
const mockBeads = {
    list: mock(async () => []),
    get: mock(async () => ({ id: 'mock-id', title: 'mock', content: 'mock' })),
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
mock.module('../../src/core/beads', () => ({
    getBeads: () => mockBeads,
}));

mock.module('../../src/core/queue', () => ({
    getQueue: () => mockQueue,
}));

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
        conductor = new Conductor();
    });

    afterEach(() => {
        conductor.stop();
        mock.restore(); // Restore mocks if needed, though module mocks persist
    });

    it('should route open beads to worker', async () => {
        // Setup state: 1 open bead, no active tickets
        mockBeads.list.mockResolvedValueOnce([{ id: 'bead-1', status: 'open', title: 'Task 1' } as Bead]);
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
        mockBeads.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'bead-2', status: 'verify', title: 'Verify 1' } as Bead]);
        // Note: cycleRouter calls open then verify.
        // It calls list({status:'open'}) then list({status:'verify'}).
        // So we need to mock list responses in order.
        mockBeads.list.mockReset();
        mockBeads.list
            .mockResolvedValueOnce([]) // Open
            .mockResolvedValueOnce([{ id: 'bead-2', status: 'verify', title: 'Verify 1' } as Bead]); // Verify

        conductor.start();
        await new Promise(r => setTimeout(r, 100));

        expect(mockRouterAgent.run).toHaveBeenCalled();
        const callArgs = mockRouterAgent.run.mock.lastCall as unknown as [string, { beadId: string, status: string }];
        expect(callArgs[1]).toEqual({ beadId: 'bead-2', status: 'verify' });

        conductor.stop();
    });
});
