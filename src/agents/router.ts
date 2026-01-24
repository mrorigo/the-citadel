import { CoreAgent } from '../core/agent';
import { getQueue } from '../core/queue';
import { z } from 'zod';

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
                getQueue().enqueue(beadId, priority, targetRole);
                return { success: true, beadId, status: 'queued', priority, targetRole };
            }
        );
    }
}
