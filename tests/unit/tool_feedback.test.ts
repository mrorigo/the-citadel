
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { CoreAgent } from '../../src/core/agent';
import { z } from 'zod';
import { LanguageModel } from 'ai';
import { loadConfig, resetConfig } from '../../src/config';

// Mock the 'ai' module
const mockGenerateText = mock();

class TestAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super('worker', model);
        this.requiresExplicitCompletion = true;

        this.registerTool(
            'strict_tool',
            'A tool with strict validation',
            z.object({
                mandatoryField: z.string().min(5),
                numberField: z.number().max(10),
            }),
            async () => ({ success: true })
        );

        this.registerTool(
            'submit_work',
            'Finalize work',
            z.object({}),
            async () => ({ success: true })
        );
    }

    protected async executeGenerateText(messages: any[]) {
        return mockGenerateText({ messages });
    }
}

describe('Tool Feedback Mechanism', () => {
    beforeEach(async () => {
        await loadConfig();
        mockGenerateText.mockReset();
    });

    afterAll(() => {
        resetConfig();
    });

    it('should return helpful Zod validation error to the agent', async () => {
        // Turn 1: Agent calls tool with invalid args (string too short, number too big)
        mockGenerateText.mockResolvedValueOnce({
            text: 'Calling tool...',
            toolCalls: [{
                toolCallId: 'call-1',
                toolName: 'strict_tool',
                input: { mandatoryField: 'abc', numberField: 100 }
            }]
        });

        // Turn 2: Agent receives error and fixes it
        mockGenerateText.mockResolvedValueOnce({
            text: 'Oops, fixing tool call.',
            toolCalls: [{
                toolCallId: 'call-2',
                toolName: 'submit_work',
                input: {}
            }]
        });

        const agent = new TestAgent({} as LanguageModel);
        await agent.run('Test task');

        expect(mockGenerateText).toHaveBeenCalledTimes(2);

        // Check the second call's history to see the error message
        const secondCallArgs = mockGenerateText.mock.calls[1][0];
        const messages = secondCallArgs.messages;

        // Find the tool-result message
        const toolResultMsg = messages.find((m: any) => m.role === 'tool');
        expect(toolResultMsg).toBeDefined();

        const toolResult = toolResultMsg.content[0];
        expect(toolResult.output.type).toBe('error-text');

        const errorText = toolResult.output.value;
        // Verify detailed feedback
        expect(errorText).toContain('Validation Error');
        expect(errorText).toContain('mandatoryField');
        expect(errorText).toContain('numberField');
        expect(errorText).toContain('retry'); // Assuming generic 'Please correct your input and retry'
    });
});
