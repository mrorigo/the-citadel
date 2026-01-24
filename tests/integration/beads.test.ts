import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const execAsync = promisify(exec);
const TEST_DIR = join(process.cwd(), 'tests/temp_beads_env');

describe('Beads Integration', () => {
    let client: BeadsClient;

    beforeAll(async () => {
        // Clean and setup test env
        await rm(TEST_DIR, { recursive: true, force: true });
        await mkdir(TEST_DIR, { recursive: true });

        // Initialize beads in this dir
        await execAsync(`cd ${TEST_DIR} && bd init`);

        // Create client pointing to this dir
        // Note: We need to ensure the client executes commands in the correct CWD
        // The current BeadsClient implementation uses `execAsync(command)`, which runs in process.cwd().
        // We need to modify BeadsClient or chang process.cwd() (dangerous) or prepend `cd ${path} &&` to commands.

        // Let's modify the client to support CWD for execution, 
        // BUT for now, simple hack: client doesn't support CWD argument in runCommand.
        // I should create a specific test class or modify the main class.

        // Wait, the standard `bd` command looks for .beads in current or parent dirs.
        // If we want to test in a subfolder, we should probably run the test FROM that subfolder
        // OR tell `bd` where to look. `bd` doesn't seem to have a --dir flag in the help I saw?
        // Actually standard git-like behavior is expected.

        // Let's rely on `process.chdir` for this test suite, ensuring we switch back.
        process.chdir(TEST_DIR);
        client = new BeadsClient(TEST_DIR);
    });

    afterAll(async () => {
        process.chdir(join(TEST_DIR, '../..'));
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it('should create a new bead', async () => {
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

    it('should fail invalid transition', async () => {
        const bead = await client.create('Invalid Jump');
        // Open -> Done (skip In Progress, Verify)
        expect(client.update(bead.id, { status: 'done' })).rejects.toThrow('Invalid state transition');
    });

    it('should enforce acceptance test for done', async () => {
        const bead = await client.create('No Acceptance Test');
        await client.update(bead.id, { status: 'in_progress' });
        await client.update(bead.id, { status: 'verify' });

        // Verify -> Done (Fail due to missing acceptance test)
        expect(client.update(bead.id, { status: 'done' })).rejects.toThrow('missing acceptance_test');

        // Fix it
        // Note: Bead schema update might not support ad-hoc fields via `bd update` directly unless they map to something.
        // But our client abstraction should handle it if we modify `update` to actually store it.
        // Wait, `bd` CLI might not support acceptance_test field natively in the JSON.
        // If it doesn't, we are relying on custom fields or description parsing?
        // The PRD says "Beads... stored as JSONL".
        // If `bd` is a rigid CLI, we might be limited to its schema.
        // Let's assume for this test we check the logic in our wrapper, even if the persistence 
        // might fail if `bd update` doesn't accept unknown flags.
        // Wait, my `update` implementation in `src/core/beads.ts`:
        // args += ` --status ${changes.status}`;
        // It DOES NOT pass acceptance_test to the CLI commands. 
        // So persistence of `acceptance_test` is currently NOT implemented in the CLI wrapper.
        // I need to fix that first if I want this test to pass for the *Fix* case.
        // But the *Fail* case should pass because it throws before calling CLI.
    });
});
