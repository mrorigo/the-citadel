
import { describe, it, expect, mock } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';

class TestBeadsClient extends BeadsClient {
    public executeMock = mock();

    protected async execute(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
        return this.executeMock(command, cwd);
    }

    // Public wrapper to access protected runCommand for testing
    public async testRunCommand(args: string): Promise<string> {
        return this.runCommand(args);
    }
}

describe('BeadsClient Retry Logic', () => {
    it('should retry on "split stack overflow" error', async () => {
        const client = new TestBeadsClient();

        // First call fails with split stack overflow
        client.executeMock.mockImplementationOnce(async () => {
            throw new Error('fatal error: runtime: split stack overflow');
        });

        // Second call succeeds
        client.executeMock.mockImplementationOnce(async () => {
            return { stdout: '{"id": "bd-1", "title": "Success", "status": "open", "created_at": "2023-01-01", "updated_at": "2023-01-01"}', stderr: '' };
        });

        const result = await client.testRunCommand('show bd-1');

        // Should have called execute twice
        expect(client.executeMock).toHaveBeenCalledTimes(2);

        // Result should match the success output
        expect(result).toContain('"title": "Success"');
    });

    it('should NOT retry on other errors', async () => {
        const client = new TestBeadsClient();

        client.executeMock.mockImplementationOnce(async () => {
            throw new Error('Some other random error');
        });

        // Should throw immediately
        await expect(client.testRunCommand('show bd-1')).rejects.toThrow('Some other random error');

        // Should have called execute once
        expect(client.executeMock).toHaveBeenCalledTimes(1);
    });

    it('should give up after retries', async () => {
        const client = new TestBeadsClient();

        // Verify we don't loop forever if the error persists
        // Current logic might hardcode retry count, let's assume it retries once or twice

        client.executeMock.mockImplementation(async () => {
            throw new Error('fatal error: runtime: split stack overflow');
        });

        await expect(client.testRunCommand('show bd-1')).rejects.toThrow('split stack overflow');

        // Depending on implementation, might call 2 or 3 times. 
        // We just want to ensure it stopped and threw eventually.
        expect(client.executeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
