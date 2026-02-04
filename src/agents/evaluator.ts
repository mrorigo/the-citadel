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
        this.requiresExplicitCompletion = true;

        // Approve
        this.registerTool(
            'approve_work',
            'Approve the work and mark the task as done',
            z.object({
                beadId: z.string().describe('The ID of the bead being evaluated'),
                acceptance_test: z.union([z.string(), z.array(z.string())]).optional().describe('REQUIRED if not already present: The specific acceptance test/criteria used to verify this work.'),
                comment: z.string().optional().describe('Optional comment on the approval'),
            }),
            async ({ beadId, acceptance_test }) => {
                const finalTest = Array.isArray(acceptance_test) ? acceptance_test.join('\n') : acceptance_test;
                await getBeads().update(beadId, { status: 'done', acceptance_test: finalTest });
                return { success: true, status: 'done' };
            }
        );

        // Reject
        this.registerTool(
            'reject_work',
            'Reject the work and send it back for rework',
            z.object({
                beadId: z.string().describe('The ID of the bead being rejected'),
                reason: z.string().describe('REQUIRED: Why the work was rejected'),
            }),
            async ({ beadId, reason }) => {
                const bead = await getBeads().get(beadId);
                await getBeads().update(beadId, {
                    status: 'open',
                    labels: [...(bead.labels || []).filter(l => l !== 'rejected'), 'rejected']
                });
                return { success: true, status: 'open', reason };
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
        The work submitted by the agent is available in the 'submitted_work' context variable.
        
        # Instructions
        - If the work is a PLAN (look for 'step:plan' or 'step:planning' labels), review 'submitted_work' for logic, completeness, and adherence to requirements.
        - If the work is an IMPLEMENTATION (look for 'step:impl' or 'step:code' labels), inspect the filesystem and run tests.
        - Note that planning steps may not result in filesystem changes.
        - Use 'approve_work' or 'reject_work' accordingly.
        - CRITICAL: When using 'reject_work', you MUST provide a clear 'reason' explaining why the work was rejected so the worker can fix it.
        - CRITICAL: When approving a plan, if the plan text contains acceptance criteria/tests, you MUST extract them and pass them to 'approve_work' via the 'acceptance_test' argument.
        `;
    }
}
