import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

describe('Pearls Integration', () => {
    let client: BeadsClient;
    let tempDir: string;
    let pearlsPath: string;

    beforeAll(async () => {
        // Setup isolated temp dir
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-pearls-int-'));

        // Pearls requires a git repo
        await execAsync('git init', { cwd: tempDir });

        pearlsPath = join(tempDir, '.pearls');
        mkdirSync(pearlsPath, { recursive: true });

        client = new BeadsClient(pearlsPath);
        await client.init(); // prl init
    });

    afterAll(async () => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create a new pearl', async () => {
        const bead = await client.create('Test Task', { priority: 0 });
        expect(bead.title).toBe('Test Task');
        expect(bead.priority).toBe(0);
        expect(bead.status).toBe('open');
    });

    it('should transition state correctly', async () => {
        // Create
        const bead = await client.create('State Machine Task');

        // Open -> In Progress
        const updated = await client.update(bead.id, { status: 'in_progress' });
        expect(updated.status).toBe('in_progress');

        // In Progress -> Verify
        const verified = await client.update(bead.id, { status: 'verify' });
        expect(verified.status).toBe('verify');
    });

    it('should allow skipping (open -> done)', async () => {
        const bead = await client.create('Skip Me');
        const skipped = await client.update(bead.id, {
            status: 'done',
            acceptance_test: 'Skipped for test'
        });
        expect(skipped.status).toBe('done');
    });

    it('should fail invalid transition', async () => {
        const bead = await client.create('Invalid Jump');
        // In Progress -> Done (skip Verify) - invalid
        await client.update(bead.id, { status: 'in_progress' });
        expect(client.update(bead.id, { status: 'done' })).rejects.toThrow('Invalid state transition');
    });

    it('should enforce acceptance test for done', async () => {
        const bead = await client.create('No Acceptance Test');
        await client.update(bead.id, { status: 'in_progress' });
        await client.update(bead.id, { status: 'verify' });

        // Verify -> Done (Fail due to missing acceptance test)
        expect(client.update(bead.id, { status: 'done' })).rejects.toThrow('missing acceptance_test');
    });
});
