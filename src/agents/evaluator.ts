import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';

export class EvaluatorAgent extends CoreAgent {
    constructor() {
        super('gatekeeper'); // Using 'gatekeeper' role from config

        // Approve
        this.registerTool(
            'approve_work',
            'Approve the work and mark the task as done',
            z.object({
                beadId: z.string().describe('The ID of the bead being evaluated'),
                comment: z.string().optional().describe('Optional comment on the approval'),
            }),
            async ({ beadId }) => {
                await getBeads().update(beadId, { status: 'done' });
                return { success: true, status: 'done' };
            }
        );

        // Reject
        this.registerTool(
            'reject_work',
            'Reject the work and send it back to in_progress',
            z.object({
                beadId: z.string().describe('The ID of the bead being rejected'),
                reason: z.string().describe('Why the work was rejected'),
            }),
            async ({ beadId, reason }) => {
                await getBeads().update(beadId, { status: 'in_progress' });
                return { success: true, status: 'in_progress', reason };
            }
        );
    }
}
