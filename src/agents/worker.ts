import type { LanguageModel } from 'ai';
import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger';
import { getQueue } from '../core/queue';
import { getFormulaRegistry } from '../core/formula';
import { jsonSchemaToZod } from '../core/schema-utils';

const execAsync = promisify(exec);

export class WorkerAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super('worker', model);

        // Report Progress
        this.registerTool(
            'report_progress',
            'Update the progress of the current task',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on'),
                message: z.string().optional().describe('Progress message'),
                reasoning: z.string().optional().describe('Reasoning or detailed progress'),
            }).passthrough(),
            async (args: { beadId: string; message?: string; reasoning?: string }) => {
                const msg = args.message || args.reasoning || "Working on it...";
                // In a real system, this would maybe comment on the issue or update a log
                // For now, we update the Bead status to ensure it's in_progress
                await getBeads().update(args.beadId, { status: 'in_progress' });
                return { success: true, message: `Updated ${args.beadId}: ${msg}` };
            }
        );

        // Submit Work - Initial Registration (Default)
        this.registerTool(
            'submit_work',
            'Submit the completed work for verification',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on (from context)'),
                summary: z.string().optional().describe('Summary of work done (required if not in output)'),
                output: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe('Output data - can be a string or structured object'),
                acceptance_test_result: z.optional(z.string().describe('Result of running the acceptance test')),
            }),
            this.handleSubmitWork
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
                command: z.string().optional().describe('The shell command to execute as a single string (e.g., "ls -la", "npm test")'),
                cmd: z.union([z.string(), z.array(z.string())]).optional().describe('Alternative: command as string or array of arguments'),
            }).passthrough(), // Allow extra params like timeout
            async (args: { command?: string; cmd?: string | string[];[key: string]: unknown }) => {
                // Normalize: accept both 'command' and 'cmd', convert arrays to strings
                let command: string | undefined;
                if (args.command) {
                    command = args.command;
                } else if (args.cmd) {
                    command = Array.isArray(args.cmd) ? args.cmd.join(' ') : args.cmd;
                }

                if (!command) {
                    return { success: false, error: 'Either "command" or "cmd" parameter must be provided' };
                }

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

    // Extracted handler for reuse
    private handleSubmitWork = async (args: { beadId: string, summary?: string, output?: unknown, acceptance_test_result?: string }) => {
        let { beadId, summary, output, acceptance_test_result: _acceptance_test_result } = args;

        // Auto-Extraction: Recover summary if nested in output (common agent error)
        if (!summary && typeof output === 'object' && output !== null && 'summary' in output) {
            const outObj = output as Record<string, unknown>;
            if (typeof outObj.summary === 'string') {
                summary = outObj.summary;
                logger.info(`[Worker] Auto-extracted summary from output payload for ${beadId}`);
            }
        }

        if (!summary) {
            throw new Error("Missing required field: 'summary'. Please provide a brief summary of the work completed.");
        }

        // Validate ticket exists FIRST (before any state changes)
        const ticket = getQueue().getActiveTicket(beadId);
        if (!ticket) {
            throw new Error(`No active ticket found for ${beadId}. Cannot submit work.`);
        }

        // Save output FIRST (before status transition)
        getQueue().complete(ticket.id, output || { summary });
        logger.info(`[Worker] Submitted work for ${beadId}`, { beadId, hasOutput: !!output });

        // THEN update status to verify
        await getBeads().update(beadId, {
            status: 'verify',
        });

        return { success: true, status: 'verify', summary };
    }

    override async run(prompt: string, context?: Record<string, unknown>): Promise<string> {
        // Bug Fix: Default schema must be permissive (object or string) to avoid blocking non-formula structured output
        let outputSchema: z.ZodTypeAny = z.record(z.string(), z.unknown()).describe('Unstructured output data (default)');

        // Dynamic Schema Lookup
        if (context?.beadId) {
            try {
                const bead = await getBeads().get(context.beadId as string);
                const formulaLabel = bead.labels?.find(l => l.startsWith('formula:'));
                const stepLabel = bead.labels?.find(l => l.startsWith('step:'));

                if (formulaLabel && stepLabel) {
                    const formulaName = formulaLabel.split(':')[1];
                    const stepId = stepLabel.split(':')[1];

                    if (formulaName && stepId) {
                        const formula = getFormulaRegistry().get(formulaName);

                        if (formula) {
                            const step = formula.steps.find(s => s.id === stepId);
                            if (step?.output_schema) {
                                outputSchema = jsonSchemaToZod(step.output_schema);
                                logger.info(`[Worker] Enforcing schema for ${bead.id} (step: ${stepId})`);
                            }
                        }
                    }
                }
            } catch (err: unknown) {
                logger.warn(`[Worker] Failed to resolve dynamic schema:`, err as Record<string, unknown> | undefined);
            }
        }

        // Re-register tool with specific schema for this run
        // Bug #2 fix: Accept both string and object for output

        const outputParamSchema = z.union([z.string(), outputSchema]).optional().describe('Output data - can be a string or match the required schema');

        this.registerTool(
            'submit_work',
            'Submit the completed work for verification',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on (from context)'),
                summary: z.string().optional().describe('Summary of work done (required if not in output)'),
                output: outputParamSchema,
                acceptance_test_result: z.optional(z.string().describe('Result of running the acceptance test')),
            }),
            this.handleSubmitWork
        );

        return super.run(prompt, context);
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
