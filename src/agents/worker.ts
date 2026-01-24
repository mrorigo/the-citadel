import { CoreAgent } from '../core/agent';
import { getBeads } from '../core/beads';
import { z } from 'zod';

export class WorkerAgent extends CoreAgent {
    constructor() {
        super('worker');

        // Report Progress
        this.registerTool(
            'report_progress',
            'Update the progress of the current task',
            z.object({
                beadId: z.string().describe('The ID of the bead being worked on'),
                message: z.string().describe('Progress message'),
            }),
            async ({ beadId, message }) => {
                // In a real system, this would maybe comment on the issue or update a log
                // For now, we update the Bead status to ensure it's in_progress
                await getBeads().update(beadId, { status: 'in_progress' });
                return { success: true, message: `Updated ${beadId}: ${message}` };
            }
        );

        // Submit Work
        this.registerTool(
            'submit_work',
            'Submit the completed work for verification',
            z.object({
                beadId: z.string(),
                summary: z.string().describe('Summary of work done'),
                acceptance_test_result: z.string().describe('Result of running the acceptance test'),
            }),
            async ({ beadId, summary, acceptance_test_result }) => {
                // Move to 'verify' state
                // This will trigger the next stage (Evaluator/Gatekeeper)
                await getBeads().update(beadId, {
                    status: 'verify',
                    // potentially append to description or comments
                });
                return { success: true, status: 'verify', summary };
            }
        );
    }
}
