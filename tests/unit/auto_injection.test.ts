import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { z } from 'zod';

const mockExecute = mock(async () => ({ success: true }));
const mockDelegate = mock(async () => ({ success: true }));

mock.module('ai', () => ({
    generateText: mock(async ({ messages }: { messages: any[] }) => {
        const lastMessage = messages[messages.length - 1].content;
        if (lastMessage.includes('delegate')) {
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
                input: { message: 'Incomplete call' }
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
                beadId: z.string(),
                message: z.string()
            }),
            mockExecute
        );
        this.registerTool(
            'delegate_tool',
            'desc',
            z.object({
                parentBeadId: z.string(),
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

    it('should auto-inject beadId from context into tool input', async () => {
        const agent = new TestAgent();
        const context = { beadId: 'test-123' };

        try {
            await agent.run('test', context);
        } catch (e) { }

        expect(mockExecute).toHaveBeenCalled();
        const callArgs = mockExecute.mock.calls[0];
        expect(callArgs[0]).toHaveProperty('beadId', 'test-123');
        expect(callArgs[0]).toHaveProperty('message', 'Incomplete call');
    });

    it('should auto-inject parentBeadId from context into tool input', async () => {
        const agent = new TestAgent();
        const context = { beadId: 'parent-456' };

        try {
            await agent.run('delegate', context);
        } catch (e) { }

        expect(mockDelegate).toHaveBeenCalled();
        const callArgs = mockDelegate.mock.calls[0];
        expect(callArgs[0]).toHaveProperty('parentBeadId', 'parent-456');
        expect(callArgs[0]).toHaveProperty('title', 'Subtask');
    });
});
