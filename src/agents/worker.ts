import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger';

const execAsync = promisify(exec);

export class WorkerAgent extends CoreAgent {
    constructor() {
        super('worker');

        // Report Progress
        this.registerTool(
            'report_progress',
            'Update the progress of the current task',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on'),
                message: z.string().describe('Progress message'),
            }),
            async ({ beadId, message }) => {
                // In a real system, this would maybe comment on the issue or update a log
                // For now, we update the Bead status to ensure it's in_progress
                await getBeads().update(beadId, { status: 'in_progress' });
                return { success: true, message: `Updated ${beadId}: ${message}` };
            }
        );

        // Submit Work
        this.registerTool(
            'submit_work',
            'Submit the completed work for verification',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on (from context)'),
                summary: z.string().describe('Summary of work done'),
                acceptance_test_result: z.optional(z.string().describe('Result of running the acceptance test')),
            }),
            async ({ beadId, summary, acceptance_test_result: _acceptance_test_result }) => {
                await getBeads().update(beadId, {
                    status: 'verify',
                });
                return { success: true, status: 'verify', summary };
            }
        );

        // Delegate / Subdivide Task
        this.registerTool(
            'delegate_task',
            'Create a subtask (child bead) to split up work',
            z.object({
                parentBeadId: z.string().describe('The ID of the current bead (becoming the parent)'),
                title: z.string().describe('Title of the subtask'),
                priority: z.number().optional().describe('Priority (0-3)'),
            }),
            async ({ parentBeadId, title, priority }) => {
                try {
                    const bead = await getBeads().create(title, {
                        parent: parentBeadId,
                        priority: (priority as 0 | 1 | 2 | 3) ?? 2
                    });
                    await getBeads().addDependency(parentBeadId, bead.id);
                    return { success: true, beadId: bead.id, message: `Created subtask ${bead.id} blocking ${parentBeadId}` };
                } catch (error: unknown) {
                    const err = error as Error;
                    return { success: false, error: err.message };
                }
            }
        );

        // --- Shell Execution ---

        this.registerTool(
            'run_command',
            'Execute a shell command',
            z.object({
                command: z.string().describe('The command to execute (e.g., "ls -la", "npm test")'),
            }),
            async ({ command }) => {
                logger.debug(`[Worker] Running command: ${command}`);
                try {
                    const { stdout, stderr } = await execAsync(command);
                    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
                } catch (error: unknown) {
                    const err = error as { message: string; stdout?: string; stderr?: string };
                    return {
                        success: false,
                        error: err.message || String(error),
                        stdout: err.stdout,
                        stderr: err.stderr
                    };
                }
            }
        );
    }

    protected override getSystemPrompt(defaultPrompt: string): string {
        return `
        ${defaultPrompt}
        
        # Filesystem
        You have access to the \`filesystem\` MCP server tools.
        - Use \`filesystem_list_directory\` and \`filesystem_read_text_file\` to explore.
        - Use \`filesystem_write_file\` to create or overwrite files.
        - Use \`filesystem_edit_file\` for precise modifications.

        # Implementation Mode
        You are the Worker. Your primary goal is to write code and fix issues.
        
        # Guidelines
        - Use filesystem tools to explore and write code.
        - Run tests with run_command if available.
        - Keep the user informed with report_progress.
        - Submit your work when done with submit_work.
        `;
    }
}
