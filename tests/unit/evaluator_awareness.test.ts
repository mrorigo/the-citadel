import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { EvaluatorAgent } from '../../src/agents/evaluator';
import { loadConfig } from '../../src/config';

describe('Evaluator Agent Awareness', () => {
    beforeAll(async () => {
        await loadConfig();
    });

    it('should receive submitted_work in context', async () => {
        const agent = new EvaluatorAgent();
        const runSpy = mock(agent.run.bind(agent));

        const context = {
            beadId: 'test-bead',
            bead: { id: 'test-bead', title: 'Test Planning Task', labels: ['step:plan'] },
            submitted_work: { plan: 'Step 1: Save the world' }
        };

        // We can't easily spy on the private run call if it's called via conductor
        // but we can test the system prompt logic indirectly or via unit tests of the agent itself.

        // Let's test if the agent's prototype has the updated prompt logic
        const systemPrompt = (agent as any).getSystemPrompt('Default');
        expect(systemPrompt).toContain('submitted_work');
        expect(systemPrompt).toContain('step:plan');
    });
});
