
import { describe, it, expect, beforeAll } from 'bun:test';
import { CoreAgent } from '../../src/core/agent';
import { resetConfig, setConfig } from '../../src/config'; // Assuming setConfig exists or we can mock getConfig
import type { ModelMessage } from 'ai';

// Mock Agent to expose protected methods or hook into run
class TestAgent extends CoreAgent {
    constructor() {
        super('worker' as any, {} as any); // Use mock model
    }

    // Helper to inject messages directly for testing pruning
    // Since 'run' constructs messages from scratch, we might need to mock executeGenerateText
    // to inspect the messages passed to it.
    public async testRun(prompt: string, initialHistory: ModelMessage[] = []) {
        // We can't really inject history into `run` easily because it builds it.
        // But `run` loops. 
        // Strategy: Mock executeGenerateText to simply return "Done" and capture the input messages.

        let capturedMessages: ModelMessage[] = [];
        this.executeGenerateText = async (messages: ModelMessage[]) => {
            // Copy messages to inspect them
            capturedMessages = [...messages];
            return {
                text: "Done",
                toolCalls: [],
                finishReason: "stop",
                usage: { promptTokens: 0, completionTokens: 0 }
            } as any;
        };

        // We also need to populate local variable `messages` in `run`.
        // `run` initializes `messages` with System + User.
        // To test pruning of *accumulated* history, we have to simulate the loop or mocking.
        // Since `run` is self-contained, checking pruning logic in-situ is hard without running the loop.

        // ALTERNATIVE: Subclass `CoreAgent` and override `run`? No.
        // The logic is IN `run`.

        // If we want to test pruning, we need `messages` to grow.
        // The loop is `for (let i=0; i<50; i++)`.
        // We can mock `executeGenerateText` to simulate conversation turns.

        let turn = 0;
        this.executeGenerateText = async (msgs: ModelMessage[]) => {
            capturedMessages = [...msgs]; // Capture what the agent SEES at this turn

            if (turn === 0) {
                // Return a lot of text or tool calls to fill history? 
                // We want to verify pruning happens on NEXT iteration.
            }
            turn++;

            // Return stop to break loop
            return {
                text: `Response ${turn}`,
                toolCalls: [],
                finishReason: "stop"
            } as any;
        };

        // This doesn't really let us test the pruning of *existing* long history 
        // unless we can inject it.
        // `messages` is defined inside `run`.
        // We can't inject.

        // HACK: We can't easily test the `messages` local variable logic without Refactoring `CoreAgent` 
        // to expose `pruneHistory(messages)` method. 
        // Refactoring is cleaner.

        return capturedMessages;
    }

    // Check tool truncation
    public async testToolTruncation(toolOutput: any) {
        this.tools['big_tool'] = {
            description: 'Returns big data',
            parameters: {} as any,
            execute: async () => toolOutput,
        } as any;

        // Mock generateText to call this tool once
        let called = false;
        this.executeGenerateText = async (msgs) => {
            if (!called) {
                called = true;
                return {
                    text: null,
                    toolCalls: [{ toolCallId: '1', toolName: 'big_tool', args: {} }],
                    finishReason: 'tool-calls'
                } as any;
            }
            return { text: 'Done', finishReason: 'stop' } as any;
        };

        const messages: ModelMessage[] = [];
        // We need to capture the tool result message added to history.
        // We can do this by inspecting what is passed to executeGenerateText on the SECOND call.

        let secondCallMessages: ModelMessage[] = [];
        const originalExec = this.executeGenerateText;
        this.executeGenerateText = async (msgs) => {
            if (msgs.some(m => m.role === 'tool')) {
                secondCallMessages = [...msgs];
            }
            return originalExec.call(this, msgs);
        };

        await this.run('Run tool');
        return secondCallMessages;
    }
}


describe('Context Management', () => {
    beforeAll(() => {
        resetConfig();
        setConfig({
            env: 'development',
            providers: {},
            beads: { path: '.beads', binary: 'bd', autoSync: true },
            worker: {
                timeout: 300,
                maxRetries: 3,
                costLimit: 1.0,
                min_workers: 1,
                max_workers: 5,
                load_factor: 1.0
            },
            agents: {
                worker: { provider: 'openai', model: 'gpt-4' },
                router: { provider: 'openai', model: 'gpt-4' },
                supervisor: { provider: 'openai', model: 'gpt-4' },
                gatekeeper: { provider: 'openai', model: 'gpt-4' }
            },
            context: {
                maxHistoryMessages: 5,
                maxToolResponseSize: 20,
                maxMessageSize: 1000
            }
        });
    });

    it('should truncate tool outputs', async () => {
        const agent = new TestAgent();
        const massiveOutput = "This is a very long string that should be truncated because it exceeds the limit.".repeat(10);

        const messages = await agent.testToolTruncation(massiveOutput);
        const toolMsg = messages.find(m => m.role === 'tool');
        expect(toolMsg).toBeDefined();

        // Limit is 20. 
        const content = toolMsg!.content as any;
        const text = content[0].result /* SDK v5? */ || content[0].text /* our adapter */ || (toolMsg as any).content[0].result;

        // In Agent.ts we push `{ type: "tool-result", ..., output: { type: "text", value: ... } }` (AI SDK Core format?)
        // Agent.ts line 555: output: toolOutput
        // toolOutput = { type: "text", value: ... }
        // The standard is `content: [ { type: 'tool-result', toolCallId, toolName, result: ... } ]`?
        // Agent.ts uses `toolResults.push({ type: "tool-result", ... output: ... })`
        // So checking `content[0].output.value`?

        // Wait, AI SDK `tool-result` part has `result` field usually?
        // Let's check `agent.ts` again.
        // It pushes `output: toolOutput`.

        const resultPart = (toolMsg!.content as any)[0];
        // resultPart.output.value

        const val = resultPart.output.value || resultPart.result;

        expect(val).toContain('... [Output truncated');
        expect(val.length).toBeLessThan(massiveOutput.length);
    });
});
