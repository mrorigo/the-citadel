
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { CoreAgent } from '../../src/core/agent';
import { z } from 'zod';
import { LanguageModel } from 'ai';
import { loadConfig, resetConfig } from '../../src/config';
import { clearGlobalSingleton } from '../../src/core/registry';

// Mock the 'ai' module
const mockGenerateText = mock();
mock.module('ai', () => ({
    generateText: mockGenerateText,
    tool: (opts: any) => opts,
    jsonSchema: (s: any) => s,
}));

class EncouragedAgent extends CoreAgent {
    constructor(model?: LanguageModel) {
        super('worker', model);
        this.requiresExplicitCompletion = true;

        this.registerTool(
            'submit_work',
            'Finalize work',
            z.object({}),
            async () => ({ success: true })
        );

        this.registerTool(
            'other_tool',
            'Do something else',
            z.object({}),
            async () => ({ success: true })
        );
    }
}

describe('Agent Encouragement Mechanism', () => {
    beforeEach(async () => {
        await loadConfig();
        mockGenerateText.mockReset();
    });

    afterAll(() => {
        clearGlobalSingleton('beads_client');
        clearGlobalSingleton('work_queue');
        clearGlobalSingleton('formula_registry');
        resetConfig();
        mock.restore();
    });

    it('should remind the agent if it returns text without a completion tool', async () => {
        // Turn 1: Agent returns text but no tool
        mockGenerateText.mockResolvedValueOnce({
            text: 'I have finished the work.',
            toolCalls: []
        });

        // Turn 2: Agent responds to reminder by calling submit_work
        mockGenerateText.mockResolvedValueOnce({
            text: 'Oh, sorry. Submitting now.',
            toolCalls: [{ toolCallId: 'call-1', toolName: 'submit_work', input: {} }]
        });

        const agent = new EncouragedAgent({} as LanguageModel);
        await agent.run('Finish the task');

        // Verify it ran twice (second time because of reminder)
        expect(mockGenerateText).toHaveBeenCalledTimes(2);

        // Verify the second call received the reminder in history at index 3
        const secondCallArgs = mockGenerateText.mock.calls[1][0];
        const messagesInSecondCall = secondCallArgs.messages;
        expect(messagesInSecondCall.length).toBeGreaterThanOrEqual(4);
        const reminderMessage = messagesInSecondCall[3];
        expect(reminderMessage.role).toBe('user');
        expect(reminderMessage.content).toContain("You provided a response but did not call a completion tool");
    });

    it('should only remind once', async () => {
        // Turn 1: Text only
        mockGenerateText.mockResolvedValueOnce({ text: 'Done.', toolCalls: [] });
        // Turn 2: Text only (ignoring reminder)
        mockGenerateText.mockResolvedValueOnce({ text: 'Still done.', toolCalls: [] });

        const agent = new EncouragedAgent({} as LanguageModel);
        await agent.run('Finish the task');

        // Should stop after turn 2 because didRemindForCompletion is true
        expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it('should NOT remind if completion tool was called', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: 'Submitting...',
            toolCalls: [{ toolCallId: 'call-1', toolName: 'submit_work', input: {} }]
        });

        const agent = new EncouragedAgent({} as LanguageModel);
        await agent.run('Finish the task');

        expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it('should NOT remind if requiresExplicitCompletion is false', async () => {
        class LazyAgent extends CoreAgent {
            constructor() { super('worker'); this.requiresExplicitCompletion = false; }
        }
        mockGenerateText.mockResolvedValueOnce({ text: 'Done.', toolCalls: [] });

        const agent = new LazyAgent();
        await agent.run('Finish the task');

        expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });
});
