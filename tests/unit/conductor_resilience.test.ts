import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import type { Bead, BeadsClient } from '../../src/core/beads';
import { setBeadsInstance } from '../../src/core/beads';
import type { WorkQueue } from '../../src/core/queue';
import { setQueueInstance } from '../../src/core/queue';
import { clearGlobalSingleton } from '../../src/core/registry';
import { logger } from '../../src/core/logger';
import { setConfig, resetConfig } from '../../src/config';

// Mock getAgentModel to avoid MCP errors and match behavior expected by other tests
mock.module('../../src/core/llm', () => ({
    getAgentModel: (role: string) => {
        // Validation to satisfy config.test.ts
        if (!['router', 'worker', 'gatekeeper', 'supervisor'].includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }
        return {
            specificationVersion: 'v2',
            provider: 'mock',
            modelId: 'mock-model',
            // biome-ignore lint/suspicious/noExplicitAny: Mocking
            doGenerate: async () => ({
                content: [{ type: 'text', text: 'Mocked Plan' }],
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 }
            })
        };
    }
}));

describe('Conductor Resilience', () => {
    let conductor: Conductor;
    let mockBeads: any;
    let mockQueue: any;

    beforeEach(() => {
        // Setup proper config
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            beads: { path: '.beads' },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 },
            agents: {
                router: { provider: 'ollama', model: 'test' },
                worker: { provider: 'ollama', model: 'test' },
                gatekeeper: { provider: 'ollama', model: 'test' },
                supervisor: { provider: 'ollama', model: 'test' }
            }
        });

        mockBeads = {
            list: mock(async () => []),
            get: mock(async () => ({ id: 'mock-id', status: 'open' })),
            ready: mock(async () => []),
            doctor: mock(async () => true),
            update: mock(async () => ({})),
        };

        mockQueue = {
            getActiveTicket: mock(() => null),
            getPendingCount: mock(() => 0),
        };

        conductor = new Conductor(mockBeads as unknown as BeadsClient, mockQueue as unknown as WorkQueue);
        setBeadsInstance(mockBeads as unknown as BeadsClient);
        setQueueInstance(mockQueue as unknown as WorkQueue);
    });

    afterEach(() => {
        conductor.stop();
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        resetConfig();
        mock.restore();
    });

    it('should fail startup if environment check fails', async () => {
        // Mock doctor failure
        mockBeads.doctor.mockResolvedValue(false);

        // Mock start log
        const initSpy = mock();
        mock.module('../../src/services/mcp', () => ({
            getMCPService: () => ({
                initialize: initSpy,
                shutdown: mock()
            })
        }));

        await conductor.start();

        // Should check doctor
        expect(mockBeads.doctor).toHaveBeenCalled();

        // Should NOT start loop (isRunning should be false)
        // Access private property via checking if loop ran? 
        // Or check if MCP initialize was called (it is called before check actually)
        // Let's check if update/list were called (loop activity)
        await new Promise(r => setTimeout(r, 50));
        expect(mockBeads.list).not.toHaveBeenCalled();
        expect(mockBeads.ready).not.toHaveBeenCalled();
    });

    it('should pass startup if environment check passes', async () => {
        mockBeads.doctor.mockResolvedValue(true);

        await conductor.start();

        expect(mockBeads.doctor).toHaveBeenCalled();
        // Wait for loop
        await new Promise(r => setTimeout(r, 50));
        expect(mockBeads.ready).toHaveBeenCalled();
    });

    // Note: Testing exponential backoff with real timeouts is slow. 
    // We implicitly trust the math in the code, or could refactor strictly for testing.
    // For now, validation check is the critical "stop the loop" feature.
});
