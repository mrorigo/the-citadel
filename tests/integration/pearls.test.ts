import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { PearlsClient } from '../../src/core/pearls';
import { resetConfig, setConfig } from '../../src/config';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

describe('Pearls Integration', () => {
    let client: PearlsClient;
    let tempDir: string;
    let pearlsPath: string;

    beforeAll(async () => {
        resetConfig();
        // Setup isolated temp dir
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-pearls-int-'));

        // Pearls requires a git repo
        await execAsync('git init', { cwd: tempDir });

        pearlsPath = join(tempDir, '.pearls');
        mkdirSync(pearlsPath, { recursive: true });

        // Ensure clean config for this test
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: {
                router: { provider: 'ollama', model: 'mock' },
                worker: { provider: 'ollama', model: 'mock' },
                gatekeeper: { provider: 'ollama', model: 'mock' }
            },
            worker: { min_workers: 1, max_workers: 1, load_factor: 1 },
            gatekeeper: { min_workers: 1, max_workers: 1, load_factor: 1 },
            pearls: { path: pearlsPath, binary: 'prl' }
        });

        client = new PearlsClient(pearlsPath);
        await client.init(); // prl init
    });

    afterAll(async () => {
        rmSync(tempDir, { recursive: true, force: true });
        resetConfig();
    });

    it('should create a new pearl', async () => {
        const pearl = await client.create('Test Task', { priority: 0 });
        expect(pearl.title).toBe('Test Task');
        expect(pearl.priority).toBe(0);
        expect(pearl.status).toBe('open');
    });

    it('should transition state correctly', async () => {
        // Create
        const pearl = await client.create('State Machine Task');

        // Open -> In Progress
        const updated = await client.update(pearl.id, { status: 'in_progress' });
        expect(updated.status).toBe('in_progress');

        // In Progress -> Verify
        const verified = await client.update(pearl.id, { status: 'verify' });
        expect(verified.status).toBe('verify');
    });

    it('should allow skipping (open -> done)', async () => {
        const pearl = await client.create('Skip Me');
        const skipped = await client.update(pearl.id, {
            status: 'done',
            acceptance_test: 'Skipped for test'
        });
        expect(skipped.status).toBe('done');
    });

    it('should fail invalid transition', async () => {
        const pearl = await client.create('Invalid Jump');
        // In Progress -> Done (skip Verify) - invalid
        await client.update(pearl.id, { status: 'in_progress' });
        expect(client.update(pearl.id, { status: 'done' })).rejects.toThrow('Invalid state transition');
    });

    it('should enforce acceptance test for done', async () => {
        const pearl = await client.create('No Acceptance Test');
        await client.update(pearl.id, { status: 'in_progress' });
        await client.update(pearl.id, { status: 'verify' });

        // Verify -> Done (Fail due to missing acceptance test)
        expect(client.update(pearl.id, { status: 'done' })).rejects.toThrow('missing acceptance_test');
    });
});
