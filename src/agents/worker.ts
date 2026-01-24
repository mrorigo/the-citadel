import { generateText, type ModelMessage, type ToolCallPart, type ToolResultPart, type TextPart } from 'ai';
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

        // --- File System Tools ---

        this.registerTool(
            'read_file',
            'Read the contents of a file',
            z.object({
                path: z.string().describe('Absolute path to file'),
            }),
            async ({ path }) => {
                console.log(`[Worker] Reading file: ${path}`);
                try {
                    const content = await readFile(path, 'utf-8');
                    return { success: true, content };
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return { success: false, error: errorMessage };
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
                console.log(`[Worker] Writing file: ${path} (${content.length} bytes)`);
                try {
                    await mkdir(dirname(path), { recursive: true });
                    await writeFile(path, content, 'utf-8');
                    return { success: true, path };
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return { success: false, error: errorMessage };
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
                const searchPath = path || '.';
                console.log(`[Worker] Listing directory: ${searchPath}`);
                try {
                    const items = await readdir(searchPath, { withFileTypes: true });
                    const listing = items.map(d => ({
                        name: d.name,
                        isDirectory: d.isDirectory()
                    }));
                    return { success: true, items: listing };
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return { success: false, error: errorMessage };
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
                console.log(`[Worker] Running command: ${command}`);
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

    // Override run to skip the separate 'think' phase which strictly blocks tools.
    // We want the Worker to be able to 'think' by exploring (running tools).
    override async run(prompt: string, context?: Record<string, unknown>): Promise<string> {
        console.log(`[${this.role}] Running (Unified Loop)...`);

        const system = `
        You are the Worker Agent. Your goal is to IMPLEMENT requested changes in the codebase.
        
        # Tools available
        - Filesystem: read_file, write_file, list_dir
        - Command: run_command
        - Reporting: report_progress, submit_work
        
        # Instructions
        - Analyze the request and explore the codebase if needed (list_dir, read_file).
        - Formulate a plan and EXECUTE it.
        - Do not just describe the code; WRITE the files.
        - Use report_progress to indicate status.
        - When finished, use 'submit_work' (with the beadId from context).
        - If you do not call any tools, the system will assume you are done.
        - YOU MUST USE TOOLS to make changes.
        `;

        const messages: ModelMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: `Context: ${JSON.stringify(context || {})}\n\nRequest: ${prompt}` }
        ];

        let finalResult = '';

        for (let i = 0; i < 100; i++) {
            const result = await generateText({
                model: this.model,
                tools: this.tools,
                messages: messages,
            });

            // Construct Assistant Message from result
            // We must manually add the assistant's response to history so the subsequent tool-result message is valid.
            const assistantContent: (TextPart | ToolCallPart)[] = [];
            if (result.text) {
                assistantContent.push({ type: 'text', text: result.text });
            }
            if (result.toolCalls && result.toolCalls.length > 0) {
                assistantContent.push(...result.toolCalls.map((tc) => ({
                    type: 'tool-call' as const,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input
                })));
            }

            // Only push if there is content
            if (assistantContent.length > 0) {
                messages.push({ role: 'assistant', content: assistantContent });
            }

            finalResult = result.text;

            // Log output
            if (result.text) {
                console.log(`[Worker] Output: ${result.text}`);
            }

            const toolCalls = result.toolCalls;

            // If no tools, we might be done or just talking.
            // But we must eventually call finish. 
            if (!toolCalls || toolCalls.length === 0) {
                continue;
            }

            // Execute tools
            const toolResults: ToolResultPart[] = [];
            let finished = false;

            for (const tc of toolCalls) {
                console.log(`[Worker] Executing tool: ${tc.toolName}`);

                if (tc.toolName === 'submit_work') {
                    finished = true;
                }

                const tool = this.tools[tc.toolName];
                if (!tool) {
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: `Tool ${tc.toolName} not found` },
                    } as ToolResultPart);
                    continue;
                }

                if (!tool.execute) {
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: `Tool ${tc.toolName} has no execute method` },
                    } as ToolResultPart);
                    continue;
                }

                try {
                    const output = await tool.execute(tc.input || {}, { toolCallId: tc.toolCallId, messages });
                    // Convert output to proper ToolResultOutput format
                    const toolOutput = typeof output === 'string'
                        ? { type: 'text' as const, value: output }
                        : { type: 'json' as const, value: output };
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: toolOutput,
                    } as ToolResultPart);
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toolResults.push({
                        type: 'tool-result',
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        output: { type: 'error-text', value: errorMessage },
                    } as ToolResultPart);
                }
            }

            messages.push({ role: 'tool', content: toolResults });


            if (finished) {
                console.log('[Worker] Task finished explicitly.');
                break;
            }
        }

        return finalResult;
    }
}
