import type { LanguageModel } from 'ai';
import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class EvaluatorAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super('gatekeeper', model);

        // Approve
        this.registerTool(
            'approve_work',
            'Approve the work and mark the task as done',
            z.object({
                beadId: z.string().describe('The ID of the bead being evaluated'),
                comment: z.string().optional().describe('Optional comment on the approval'),
            }),
            async ({ beadId }) => {
                await getBeads().update(beadId, { status: 'done' });
                return { success: true, status: 'done' };
            }
        );

        // Reject
        this.registerTool(
            'reject_work',
            'Reject the work and send it back to in_progress',
            z.object({
                beadId: z.string().describe('The ID of the bead being rejected'),
                reason: z.string().describe('Why the work was rejected'),
            }),
            async ({ beadId, reason }) => {
                await getBeads().update(beadId, { status: 'in_progress' });
                return { success: true, status: 'in_progress', reason };
            }
        );

        // Fail
        this.registerTool(
            'fail_work',
            'Mark the work as terminal failure (triggers recovery steps if defined)',
            z.object({
                beadId: z.string().describe('The ID of the bead being failed'),
                reason: z.string().describe('Why the work is considered a terminal failure'),
            }),
            async ({ beadId }) => {
                await getBeads().update(beadId, {
                    status: 'done',
                    labels: ['failed']
                });
                return { success: true, status: 'done', failed: true };
            }
        );

        this.registerTool(
            'run_command',
            'Execute a shell command (e.g. to run tests)',
            z.object({ command: z.string() }),
            async ({ command }) => {
                try {
                    const { stdout, stderr } = await execAsync(command);
                    return { success: true, stdout, stderr };
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return { success: false, error: errorMessage };
                }
            }
        );
    }
    protected override getSystemPrompt(defaultPrompt: string): string {
        return `
        ${defaultPrompt}

        # Context
        You are the Gatekeeper (Evaluator). Your goal is to VERIFY that the work meets requirements.
        
        # Instructions
        - Use \`filesystem_read_text_file\` and \`filesystem_list_directory\` to inspect the code.
        - Use run_command to run tests (e.g. npm test).
        - If satisfied, use 'approve_work'.
        - If issues found, use 'reject_work' with a reason.
        `;
    }
}
