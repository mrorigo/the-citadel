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
            'Enqueue a bead for execution. Use queue="worker" for open tasks, queue="gatekeeper" for verify tasks.',
            z.object({
                beadId: z.string().optional().describe('The ID of the bead to enqueue (defaults to current bead from context)'),
                reasoning: z.string().describe('Why this task should be enqueued'),
                queue: z.enum(['worker', 'gatekeeper']).describe('REQUIRED: worker for open tasks, gatekeeper for verify tasks'),
                priority: z.number().min(0).max(3).optional().describe('Priority (0-3, default 2)'),
            }),
            async (args: { beadId?: string; reasoning: string; queue: 'worker' | 'gatekeeper'; priority?: number }, context?: { beadId?: string }) => {
                // Use beadId from args, or fall back to context
                const beadId = args.beadId || context?.beadId;
                if (!beadId) {
                    return { success: false, error: 'beadId must be provided either as parameter or in context' };
                }

                try {
                    getQueue().enqueue(beadId, args.priority ?? 2, args.queue);
                    return { success: true, message: `Enqueued ${beadId} to ${args.queue}` };
                } catch (error: unknown) {
                    const err = error as Error;
                    return { success: false, error: err.message };
                }
            }
        );

        this.registerTool(
            'instantiate_formula',
            'Instantiate a named workflow formula (e.g., system_migration)',
            z.object({
                formulaName: z.string().describe('The name of the formula to run'),
                variables: z.object({}).passthrough().optional().default({}).describe('Variables to inject into the formula (e.g., { "target_system": "Auth" })'),
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
        
        # Available Queues
        - 'worker': For implementation, coding, and general tasks (status: 'open').
        - 'gatekeeper': For verification and testing tasks (status: 'verify').
        - 'formula': specialized workflows defined in .citadel/formulas/ (e.g., system_migration).

        # Routing Rules (CRITICAL)
        - Tasks with status='open' → enqueue_task with queue='worker'
        - Tasks with status='verify' → enqueue_task with queue='gatekeeper'
        - ALWAYS specify the queue parameter explicitly in enqueue_task
        
        # Instructions
        - Analyze the Request and Context.
        - Decide which queue to route to based on the bead status.
        - Decide the priority (0=Critical, 1=High, 2=Normal, 3=Low).
        - Call 'enqueue_task' with the correct queue parameter.
        - Use 'instantiate_formula' if the request matches a known formula.
        `;
    }
}
