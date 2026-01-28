import { getBeads } from '../core/beads';
import { getQueue } from '../core/queue';
import { logger } from '../core/logger';
import { type Bead } from '../core/beads';

export class DataPiper {
    private beads = getBeads();
    private queue = getQueue();

    /**
     * Attempts to pipe data into a Bead's context from its dependencies.
     * key logic:
     * 1. Check if bead has 'context' (we need to parse it from description if not stored separately in memory yet, 
     *    but beads client handles this?) 
     *    Actually, BeadsClient parse logic extracts context. 
     * 2. If valid context found, scan values for {{steps.ID.output...}} patterns.
     * 3. Fetch outputs for referenced steps.
     * 4. Resolve values.
     * 5. Update bead context.
     */
    async pipeData(beadId: string): Promise<boolean> {
        try {
            const bead = await this.beads.get(beadId);
            if (!bead.context) return false;

            let hasChanges = false;
            const newContext: Record<string, any> = { ...bead.context };

            // Helper to traverse object and resolve strings
            const resolveObject = async (obj: any): Promise<boolean> => {
                let changed = false;
                for (const key in obj) {
                    const val = obj[key];
                    if (typeof val === 'string' && val.includes('{{')) {
                        const resolved = await this.resolveTemplate(val, bead);
                        if (resolved !== val) {
                            obj[key] = resolved;
                            changed = true;
                        }
                    } else if (typeof val === 'object' && val !== null) {
                        if (await resolveObject(val)) changed = true;
                    }
                }
                return changed;
            };

            hasChanges = await resolveObject(newContext);

            if (hasChanges) {
                logger.info(`[Piper] Resolved data for bead ${beadId}`, { newContext });
                await this.beads.update(beadId, { context: newContext });
                return true;
            }

            return false;
        } catch (error) {
            logger.error(`[Piper] Failed to pipe data for ${beadId}`, error);
            return false;
        }
    }

    private async resolveTemplate(template: string, bead: Bead): Promise<any> {
        // Regex for {{steps.ID.output.KEY}}
        // Also support {{steps.ID.output}} (full object)

        // Check for full replacement first (if the string is EXACTLY the template)
        // allowing us to inject objects/arrays, not just strings.
        const fullMatch = template.match(/^{{steps\.([^\.]+)\.output(?:\.(.+))?}}$/);
        if (fullMatch) {
            const stepId = fullMatch[1];
            const path = fullMatch[2];
            if (stepId) {
                return await this.fetchValue(bead, stepId, path);
            }
        }

        // Partial replacement (string interpolation)
        // "Title: {{steps.foo.output.title}}"
        return template.replace(/{{steps\.([^\.]+)\.output(?:\.(.+))?}}/g, (_match, stepId, path) => {
            // We can't support async inside replace easily without specific patterns,
            // but since we are doing one pass, we might have to fetch first.
            // Actually, simplest is to use a replacer that returns a placeholder?
            // No, let's just resolve one by one.
            // For now, let's limit support to FULL replacement or assume simple strings for partials.
            // WARN: Synchronous replace with async fetch is hard.
            // Let's iterate matches.
            return _match; // Placeholder, see logic below
        });
    }

    // Simplified: Only support FULL property replacement for V1.
    // "key": "{{steps.foo.output.bar}}"
    // Mixed interpolation "Hello {{...}}" is harder with async resolution and types.

    private async fetchValue(currentBead: Bead, targetStepId: string, outputKey?: string): Promise<any> {
        // 1. Find the target bead ID. 
        // The 'stepId' in the template usually refers to the Formula Step ID, 
        // NOT the Bead ID directly (since Bead IDs are GUIDs).
        // However, we don't easily know the map from Formula Step ID -> Bead ID here 
        // unless we traverse the dependency graph or look at metadata labels.

        // Strategy: look at dependencies. 
        // Use logic: "Which dependency was created from stepId?"
        // Ideally, beads should have a label or property `formula_step:ID`

        // FALLBACK: For V1, assume specific labeling or name matching?
        // Better: WorkflowEngine creates beads. It should tag them?
        // Let's assume for this implementation plan we need to find the dependency bead.

        // Let's look at block dependencies (needs).
        const blockers = currentBead.blockers || [];

        // We need to resolve `stepId` (e.g. "generator") to a `beadId`.
        // The Bead doesn't natively store "I am step 'generator'".
        // FIX Needed: Update WorkflowEngine to add labels!
        // But for now, we can try to search dependencies by title or description context?
        // No, that's brittle.

        // CRITICAL: We need a way to map 'stepId' to 'beadId'.
        // Assumption: The WorkflowEngine adds a label `step:ID`.
        // I will add this to WorkflowEngine in the next step.

        // Find dependency with label `step:{targetStepId}`
        const dependencyId = await this.findDependencyIdByStep(blockers, targetStepId);

        if (!dependencyId) {
            logger.warn(`[Piper] Could not find dependency for step '${targetStepId}' in bead ${currentBead.id}`);
            return `{{steps.${targetStepId}.output...}}`; // Unresolved
        }

        const output = await this.queue.getOutput(dependencyId);
        if (!output) return null;

        if (!outputKey) return output;

        // Deep access
        return outputKey.split('.').reduce((o: any, k) => (o ? o[k] : null), output);
    }

    private async findDependencyIdByStep(candidateIds: string[], stepId: string): Promise<string | undefined> {
        for (const id of candidateIds) {
            const bead = await this.beads.get(id);
            if (bead.labels?.includes(`step:${stepId}`)) {
                return id;
            }
        }
        return undefined;
    }

}

// Singleton
let _piper: DataPiper | null = null;
export function getPiper(): DataPiper {
    if (!_piper) _piper = new DataPiper();
    return _piper;
}
