
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PearlsClient } from '../../src/core/pearls';
import { clearGlobalSingleton } from '../../src/core/registry';
import { setConfig, resetConfig } from '../../src/config';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Test suite for verifying FSM bugs reported in Evaluator
describe('Evaluator State Logic (Reproduction)', () => {
    let pearls: PearlsClient;
    let tempDir: string;

    beforeEach(async () => {
        clearGlobalSingleton('pearls_client');

        // Setup isolated temp dir
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-eval-state-'));

        // Pearls requires git repo
        await execAsync('git init', { cwd: tempDir });

        const pearlsPath = join(tempDir, '.pearls');
        mkdirSync(pearlsPath, { recursive: true });

        // Force config for prl
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: { router: { provider: 'ollama', model: 'mock' }, worker: { provider: 'ollama', model: 'mock' }, gatekeeper: { provider: 'ollama', model: 'mock' } },
            pearls: { path: pearlsPath, binary: 'prl', autoSync: true },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 }
        });

        pearls = new PearlsClient(pearlsPath);
        await pearls.init();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should allow transitioning from verify to open (Bug 1 Fix)', async () => {
        // 1. Create pearl
        const pearl = await pearls.create('Test Pearl 1');

        // 2. Move to in_progress -> verify
        await pearls.update(pearl.id, { status: 'in_progress' });
        await pearls.update(pearl.id, { status: 'verify' });

        // 3. Attempt verify -> open (Simulating reject_work)
        await pearls.update(pearl.id, { status: 'open' });

        // Verify final state
        const updated = await pearls.get(pearl.id);
        expect(updated.status).toBe('open');
    });

    it('should allow transitioning from verify to done with failed label (Bug 2 Fix)', async () => {
        // 1. Create pearl
        const pearl = await pearls.create('Test Pearl 2');

        // 2. Move to verify
        await pearls.update(pearl.id, { status: 'in_progress' });
        await pearls.update(pearl.id, { status: 'verify' });

        // 3. Attempt verify -> done + failed (Simulating fail_work)
        await pearls.update(pearl.id, {
            status: 'done',
            labels: ['failed']
        });

        // Verify final state
        const updated = await pearls.get(pearl.id);
        expect(updated.status).toBe('done');
        expect(updated.labels).toContain('failed');
    });
});
