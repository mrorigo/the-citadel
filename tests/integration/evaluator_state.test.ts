
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
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
    let beads: BeadsClient;
    let tempDir: string;

    beforeEach(async () => {
        clearGlobalSingleton('beads_client');

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
            beads: { path: pearlsPath, binary: 'prl', autoSync: true },
            worker: { min_workers: 0, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 0, max_workers: 1, load_factor: 1 }
        });

        beads = new BeadsClient(pearlsPath);
        await beads.init();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should allow transitioning from verify to open (Bug 1 Fix)', async () => {
        // 1. Create bead
        const bead = await beads.create('Test Bead 1');

        // 2. Move to in_progress -> verify
        await beads.update(bead.id, { status: 'in_progress' });
        await beads.update(bead.id, { status: 'verify' });

        // 3. Attempt verify -> open (Simulating reject_work)
        await beads.update(bead.id, { status: 'open' });

        // Verify final state
        const updated = await beads.get(bead.id);
        expect(updated.status).toBe('open');
    });

    it('should allow transitioning from verify to done with failed label (Bug 2 Fix)', async () => {
        // 1. Create bead
        const bead = await beads.create('Test Bead 2');

        // 2. Move to verify
        await beads.update(bead.id, { status: 'in_progress' });
        await beads.update(bead.id, { status: 'verify' });

        // 3. Attempt verify -> done + failed (Simulating fail_work)
        await beads.update(bead.id, {
            status: 'done',
            labels: ['failed']
        });

        // Verify final state
        const updated = await beads.get(bead.id);
        expect(updated.status).toBe('done');
        expect(updated.labels).toContain('failed');
    });
});
