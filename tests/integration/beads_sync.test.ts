
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Pearls Sync', () => {
    let tempDir: string;
    let pearlsPath: string;

    beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'citadel-pearls-sync-'));
        pearlsPath = join(tempDir, '.pearls');
    });

    afterAll(async () => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should call prl sync when sync() is called', async () => {
        class MockPearlsClient extends BeadsClient {
            public syncCalled = false;

            protected override async execute(command: string, _cwd: string): Promise<{ stdout: string; stderr: string }> {
                if (command.includes('sync')) {
                    this.syncCalled = true;
                    return { stdout: 'OK', stderr: '' };
                }
                return { stdout: '', stderr: '' };
            }
        }

        const client = new MockPearlsClient(pearlsPath);
        await client.sync();

        expect(client.syncCalled).toBe(true);
    });
});
