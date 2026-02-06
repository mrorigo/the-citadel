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

describe('BeadsClient No-DB Mode', () => {
    it('should inject --no-db flag into runCommand', async () => {
        const client = new TestBeadsClient();

        client.executeMock.mockResolvedValue({ stdout: '{}', stderr: '' });

        await client.testRunCommand('list --json');

        // Check if the command string contains --no-db
        expect(client.executeMock).toHaveBeenCalled();
        const callArgs = client.executeMock.mock.calls[0];
        const command = callArgs[0] as string;

        expect(command).toContain('--no-db');
        expect(command).toContain('--sandbox'); // Should also have sandbox
        expect(command).toContain('list --json');
    });

    it('should inject --no-db flag into init', async () => {
        const client = new TestBeadsClient();
        client.executeMock.mockResolvedValue({ stdout: '', stderr: '' });

        await client.init();

        const callArgs = client.executeMock.mock.calls[0];
        const command = callArgs[0] as string;

        expect(command).toContain('init');
        expect(command).toContain('--no-db');
    });
});
