import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { Conductor } from '../../src/services/conductor';
import type { Pearl, PearlsClient } from '../../src/core/pearls';
import { setPearlsInstance } from '../../src/core/pearls';
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
    let mockPearls: any;
    let mockQueue: any;

    beforeEach(() => {
        // Setup proper config
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            pearls: { path: '.pearls' },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 },
            agents: {
                router: { provider: 'ollama', model: 'test' },
                worker: { provider: 'ollama', model: 'test' },
                gatekeeper: { provider: 'ollama', model: 'test' },
                supervisor: { provider: 'ollama', model: 'test' }
            }
        });

        mockPearls = {
            list: mock(async () => []),
            get: mock(async () => ({ id: 'mock-id', status: 'open' })),
            ready: mock(async () => []),
            doctor: mock(async () => true),
            update: mock(async () => ({})),
            create: mock(async () => ({ id: 'new-pearl' })),
            addDependency: mock(async () => ({})),
        };

        mockQueue = {
            getActiveTicket: mock(() => null),
            getPendingCount: mock(() => 0),
            getLatestTicket: mock(() => null),
        };

        conductor = new Conductor(mockPearls as unknown as PearlsClient, mockQueue as unknown as WorkQueue);
        setPearlsInstance(mockPearls as unknown as PearlsClient);
        setQueueInstance(mockQueue as unknown as WorkQueue);
    });

    afterEach(() => {
        conductor.stop();
    });

    afterAll(() => {
        conductor.stop();
        clearGlobalSingleton('pearls_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
        mock.restore();
    });

    it('should fail startup if environment check fails', async () => {
        // Mock doctor failure
        mockPearls.doctor.mockResolvedValue(false);

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
        expect(mockPearls.doctor).toHaveBeenCalled();

        // Should NOT start loop (isRunning should be false)
        // Access private property via checking if loop ran? 
        // Or check if MCP initialize was called (it is called before check actually)
        // Let's check if update/list were called (loop activity)
        await new Promise(r => setTimeout(r, 50));
        expect(mockPearls.list).not.toHaveBeenCalled();
        expect(mockPearls.ready).not.toHaveBeenCalled();
    });

    it('should pass startup if environment check passes', async () => {
        mockPearls.doctor.mockResolvedValue(true);

        await conductor.start();

        expect(mockPearls.doctor).toHaveBeenCalled();
        // Wait for loop
        await new Promise(r => setTimeout(r, 50));
        expect(mockPearls.ready).toHaveBeenCalled();
    });

    // Note: Testing exponential backoff with real timeouts is slow. 
    // We implicitly trust the math in the code, or could refactor strictly for testing.
    // For now, validation check is the critical "stop the loop" feature.
});
