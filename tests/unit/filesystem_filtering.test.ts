
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WorkerAgent } from '../../src/agents/worker';
import { setProjectContextInstance } from '../../src/services/project-context';
import { setGlobalSingleton } from '../../src/core/registry';
import { CONFIG_KEY } from '../../src/config';

// Mock Project Context
const mockResolveContext = mock(async () => ({
    config: {
        raw: '',
        frontmatter: {
            forbidden: ['*.secret', 'node_modules'],
            ignore: ['*.ignored'],
            read_only: []
        }
    }
}));

const mockProjectContextService = {
    resolveContext: mockResolveContext,
    loadContext: mock(async () => ({})),
} as any;

describe('Filesystem Tool Filtering', () => {
    let agent: WorkerAgent;
    let mockToolExecute: any;

    beforeEach(() => {
        // Seed config manually to avoid loadConfig issues in test env
        setGlobalSingleton(CONFIG_KEY, {
            beads: { autoSync: false },
            agents: {
                worker: {
                    provider: 'openai',
                    model: 'gpt-4o'
                }
            }
        });

        setProjectContextInstance(mockProjectContextService);
        agent = new WorkerAgent();

        mockToolExecute = mock(async (args: any) => {
            // Mock behaviors based on args or just return simple output
            return { content: [{ type: 'text', text: '[FILE] safe.txt\n[FILE] super.secret\n[DIR] node_modules' }] };
        });

        // Inject a mock tool directly
        (agent as any).tools = {
            'filesystem_list_directory': {
                name: 'filesystem_list_directory',
                description: 'ls',
                execute: mockToolExecute,
                serverName: 'filesystem'
            },
            'filesystem_search_files': {
                name: 'filesystem_search_files',
                description: 'search',
                execute: mockToolExecute,
                serverName: 'filesystem'
            }
        };
        (agent as any).schemas = {}; // No schemas for this test
    });

    afterEach(() => {
        mock.restore();
    });

    it('should filter forbidden files from list_directory output', async () => {
        // We simulate a tool result that includes secret files
        mockToolExecute.mockResolvedValueOnce({
            content: [{ type: 'text', text: '[FILE] safe.txt\n[FILE] super.secret\n[DIR] node_modules\n[FILE] ok.js' }]
        });

        // Type casting to Bypass protected access
        // biome-ignore lint/suspicious/noExplicitAny: access private for testing
        (agent as any).executeGenerateText = mock(async (msgs: any) => {
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg.role === 'user') {
                // Return partial object that satisfies necessary runtime properties 
                // even if it doesn't match full GenerationResult type for TS
                return {
                    text: 'Calling tool',
                    toolCalls: [{ toolCallId: 'call_1', toolName: 'filesystem_list_directory', input: { path: '.' } }],
                    finishReason: 'tool-calls',
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    // Add other required fields as needed or cast to unknown first
                } as any;
            }
            // After tool execution, the last msg will be tool-result
            if (lastMsg.role === 'tool') {
                return { text: 'Done', finishReason: 'stop', usage: {}, toolCalls: [] } as any;
            }
            return { text: 'Done', finishReason: 'stop', usage: {}, toolCalls: [] } as any;
        });

        await agent.run('start');

        // Capture the messages passed to the second call of executeGenerateText
        // Find the call that contains the tool result
        const calls = (agent as any).executeGenerateText.mock.calls;
        let toolResultMsg: any;

        for (const call of calls) {
            const msgs = call[0];
            const found = msgs.find((m: any) => m.role === 'tool');
            if (found) {
                toolResultMsg = found;
                break;
            }
        }

        expect(toolResultMsg).toBeDefined();

        // The structure depends on how CoreAgent constructs ToolResultPart
        // Assuming CoreAgent pushes { output: { type: 'json'|'text', value: ... } }
        // toolResultMsg.content[0] is the ToolResultPart (which effectively is casted to allow 'output' property)

        const toolResultPart = toolResultMsg.content[0];

        // Check for 'output' or 'result' property
        const resultWrapper = (toolResultPart as any).output || (toolResultPart as any).result;

        // resultWrapper should be { type: ..., value: ... }
        // The actual value returned by tool.execute is inside .value
        // CoreAgent stringifies the output, so we need to parse it back
        const actualOutput = JSON.parse(resultWrapper.value);

        // The output of list_directory (after filtering) is { content: [ { type: 'text', text: ... } ] } 
        // OR it might have been normalized to just text if list_directory returns string? 
        // My mock returns object with content array. CoreAgent updates the content array in place.
        // So actualOutput should be { content: [ { type: 'text', text: ... } ] }

        const filteredContentText = actualOutput.content[0].text;

        expect(filteredContentText).toContain('safe.txt');
        expect(filteredContentText).toContain('ok.js');
        expect(filteredContentText).not.toContain('super.secret');
        expect(filteredContentText).not.toContain('node_modules');
    });

    it('should inject exclude patterns into search_files', async () => {
        (agent as any).executeGenerateText = mock(async (msgs: any) => {
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg.role === 'user') {
                return {
                    text: 'Searching',
                    toolCalls: [{ toolCallId: 'call_2', toolName: 'filesystem_search_files', input: { path: '.', query: 'foo' } }],
                    finishReason: 'tool-calls',
                    usage: {}
                } as any;
            }
            return { text: 'Done', finishReason: 'stop', usage: {}, toolCalls: [] } as any;
        });

        await agent.run('search');

        // Check the args passed to the tool execute function
        const toolCallArgs = mockToolExecute.mock.calls[0][0]; // First arg is validatedInput

        expect(toolCallArgs.exclude).toBeDefined();
        expect(toolCallArgs.exclude).toContain('*.secret');
        expect(toolCallArgs.exclude).toContain('*.ignored');
        expect(toolCallArgs.exclude).toContain('node_modules');
    });
});
