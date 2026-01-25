import { CoreAgent } from '../core/agent';
import { getQueue } from '../core/queue';
import { z } from 'zod';
import { getWorkflowEngine } from '../services/workflow-engine';

export class RouterAgent extends CoreAgent {
    constructor() {
        super('router');

        // Register Tools
        this.registerTool(
            'enqueue_task',
            'Enqueue a bead for execution by a worker',
            z.object({
                beadId: z.string().describe('The ID of the bead to enqueue'),
                priority: z.number().min(0).max(3).describe('Priority of the task (0=Highest, 3=Lowest)'),
                targetRole: z.enum(['worker', 'gatekeeper']).describe('The role that should process this task'),
                reasoning: z.string().describe('Why this priority was chosen'),
            }),
            async ({ beadId, priority, targetRole }) => {
                // Defensive: Ensure bead actually exists.
                // This prevents hallucinations like 'thec-citadel-123' caused by LLM typos.
                try {
                    await import('../core/beads').then(m => m.getBeads().get(beadId));
                } catch {
                    return { success: false, error: `Bead ${beadId} does not exist.` };
                }

                getQueue().enqueue(beadId, priority, targetRole);
                return { success: true, beadId, status: 'queued', priority, targetRole };
            }
        );

        this.registerTool(
            'instantiate_formula',
            'Instantiate a named workflow formula (e.g., system_migration)',
            z.object({
                formulaName: z.string().describe('The name of the formula to run'),
                variables: z.record(z.string(), z.string()).describe('Variables to inject into the formula (e.g., { target_system: "Auth" })'),
                parentConvoyId: z.string().optional().describe('ID of the Convoy to assign this molecule to (optional)'),
            }),
            async ({ formulaName, variables, parentConvoyId }) => {
                try {
                    const moleculeId = await getWorkflowEngine().instantiateFormula(formulaName, variables as Record<string, string>, parentConvoyId);
                    return { success: true, moleculeId, status: 'created' };
                } catch (error: unknown) {
                    const err = error as Error;
                    return { success: false, error: err.message };
                }
            }
        );
    }

    protected override getSystemPrompt(defaultPrompt: string): string {
        return `
        ${defaultPrompt}

        # Context
        You are the Router Agent. Your purpose is to route tasks to the correct agent queue.
        
        # Available Queues (Roles)
        - 'worker': For implementation, coding, and general tasks (status: 'open').
        - 'gatekeeper': For verification and testing tasks (status: 'verify').
        - 'formula': specialized workflows defined in .citadel/formulas/ (e.g., system_migration).

        # Instructions
        - Analyze the Request and Context.
        - Decide which role to route to.
        - Decide the priority (0=Critical, 1=High, 2=Normal, 3=Low).
        - Call 'enqueue_task' to route the work.
        - Use 'instantiate_formula' if the request matches a known formula.
        `;
    }
}
