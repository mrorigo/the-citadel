import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { z } from 'zod';

const mockExecute = mock(async () => ({ success: true }));
const mockDelegate = mock(async () => ({ success: true }));

mock.module('ai', () => ({
    generateText: mock(async ({ messages }: { messages: any[] }) => {
        const lastMessage = messages[messages.length - 1];

        // If we already have a tool output in the history, just return a final response
        if (messages.some(m => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-result')))) {
            return {
                text: 'Done',
                toolCalls: []
            };
        }

        const content = lastMessage.content;
        const textContent = typeof content === 'string' ? content : JSON.stringify(content);

        if (textContent.includes('delegate')) {
            return {
                text: 'Delegating',
                toolCalls: [{
                    toolCallId: 'call-2',
                    toolName: 'delegate_tool',
                    input: { title: 'Subtask' }
                }]
            };
        }
        return {
            text: 'Executing tool',
            toolCalls: [{
                toolCallId: 'call-1',
                toolName: 'test_tool',
                input: { message: 'Executing tool' }
            }]
        };
    }),
    jsonSchema: (schema: any) => schema,
}));

import { loadConfig } from '../../src/config';
import { CoreAgent } from '../../src/core/agent';

class TestAgent extends CoreAgent {
    constructor() {
        super('worker');
        this.registerTool(
            'test_tool',
            'desc',
            z.object({
                message: z.string()
            }),
            mockExecute
        );
        this.registerTool(
            'delegate_tool',
            'desc',
            z.object({
                title: z.string()
            }),
            mockDelegate
        );
    }
}

describe('Parameter Auto-Injection', () => {
    beforeAll(async () => {
        await loadConfig();
    });

    it('should use pearlId from context in tool execution', async () => {
        const agent = new TestAgent();
        const context = { pearlId: 'test-123' };

        // TestAgent.test_tool still has pearlId in schema for this test's purpose
        // but CoreAgent no longer auto-injects it into the input.
        // However, tools in src/tools are refactored to use context.

        await agent.run('test', context);

        expect(mockExecute).toHaveBeenCalled();
        const callArgs = mockExecute.mock.calls[0];
        // In the new architecture, the tool's execute() method receives (args, toolContext)
        // where toolContext contains pearlId.
        expect(callArgs[2]).toHaveProperty('pearlId', 'test-123');
        expect(callArgs[0]).toHaveProperty('message', 'Executing tool');
    });

    it('should use parentPearlId in delegate tool', async () => {
        const agent = new TestAgent();
        const context = { pearlId: 'parent-456' };

        await agent.run('delegate', context);

        expect(mockDelegate).toHaveBeenCalled();
        const callArgs = mockDelegate.mock.calls[0];
        expect(callArgs[2]).toHaveProperty('pearlId', 'parent-456');
        expect(callArgs[0]).toHaveProperty('title', 'Subtask');
    });
});
