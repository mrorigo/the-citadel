import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';

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
                beadId: z.string(),
                summary: z.string().describe('Summary of work done'),
                acceptance_test_result: z.string().describe('Result of running the acceptance test'),
            }),
            async ({ beadId, summary, acceptance_test_result: _acceptance_test_result }) => {
                // Move to 'verify' state
                // This will trigger the next stage (Evaluator/Gatekeeper)
                await getBeads().update(beadId, {
                    status: 'verify',
                    // potentially append to description or comments
                });
                return { success: true, status: 'verify', summary };
            }
        );

        // --- File System Tools ---

        this.registerTool(
            'read_file',
            'Read the contents of a file',
            z.object({
                path: z.string().describe('Absolute path to file'),
            }),
            async ({ path }) => {
                try {
                    const content = await readFile(path, 'utf-8');
                    return { success: true, content };
                    // biome-ignore lint/suspicious/noExplicitAny: fs error
                } catch (error: any) {
                    return { success: false, error: error.message };
                }
            }
        );

        this.registerTool(
            'write_file',
            'Create or overwrite a file with new content',
            z.object({
                path: z.string().describe('Absolute path to file'),
                content: z.string().describe('The content to write'),
            }),
            async ({ path, content }) => {
                try {
                    await mkdir(dirname(path), { recursive: true });
                    await writeFile(path, content, 'utf-8');
                    return { success: true, path };
                    // biome-ignore lint/suspicious/noExplicitAny: fs error
                } catch (error: any) {
                    return { success: false, error: error.message };
                }
            }
        );

        this.registerTool(
            'list_dir',
            'List files and directories in a path',
            z.object({
                path: z.string().describe('Absolute path to directory'),
            }),
            async ({ path }) => {
                try {
                    const items = await readdir(path, { withFileTypes: true });
                    const listing = items.map(d => ({
                        name: d.name,
                        isDirectory: d.isDirectory()
                    }));
                    return { success: true, items: listing };
                    // biome-ignore lint/suspicious/noExplicitAny: fs error
                } catch (error: any) {
                    return { success: false, error: error.message };
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
                try {
                    const { stdout, stderr } = await execAsync(command);
                    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
                    // biome-ignore lint/suspicious/noExplicitAny: exec error
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        stdout: error.stdout,
                        stderr: error.stderr
                    };
                }
            }
        );
    }

    protected override getSystemPrompt(phase: 'think' | 'act', defaultPrompt: string): string {
        const base = `
        You are the Worker Agent. Your goal is to IMPLEMENT requested changes in the codebase.
        
        # Tools available
        - Filesystem: read_file, write_file, list_dir
        - Command: run_command
        - Reporting: report_progress, submit_work
        `;

        if (phase === 'think') {
            return `${base}
            # Instructions
            - Analyze the Request.
            - Explore the codebase if needed (plan to list_dir/read_file).
            - Formulate a step-by-step implementation plan.
            - Output the plan as text.
            `;
        }

        if (phase === 'act') {
            return `${base}
            # Instructions
            - EXECUTE the plan using the tools.
            - Do not just describe the code; WRITE the files.
            - If you need to read a file first, call read_file.
            - Use report_progress to indicate status.
            - When finished, use submit_work.
            - YOU MUST USE TOOLS to make changes.
            `;
        }

        return defaultPrompt;
    }
}
