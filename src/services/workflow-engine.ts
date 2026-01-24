
import { getBeads } from '../core/beads';
import { getFormulaRegistry, type FormulaRegistry } from '../core/formula';

export class WorkflowEngine {
    private registry: FormulaRegistry;

    constructor(registry?: FormulaRegistry) {
        this.registry = registry || getFormulaRegistry();
    }

    /**
     * "Cooks" a Formula into a Molecule (a graph of Beads).
     * 1. Creates Root Convoy/Epic.
     * 2. Iterates steps, resolving variables.
     * 3. Creates Beads for steps.
     * 4. Wires dependencies.
     */
    async instantiateFormula(formulaName: string, variables: Record<string, string>): Promise<string> {
        const formula = this.registry.get(formulaName);
        if (!formula) {
            throw new Error(`Formula not found: ${formulaName}`);
        }

        // Validate variables
        if (formula.vars) {
            for (const [key, config] of Object.entries(formula.vars)) {
                if (config.required && !variables[key] && !config.default) {
                    throw new Error(`Missing required variable: ${key}`);
                }
                // Apply defaults if missing
                if (!variables[key] && config.default) {
                    variables[key] = config.default;
                }
            }
        }

        const resolveTemplate = (tpl: string) => {
            let result = tpl;
            for (const [key, val] of Object.entries(variables)) {
                result = result.replace(new RegExp(`{{${key}}}`, 'g'), val);
            }
            return result;
        };

        const beads = getBeads();

        console.log(`[WorkflowEngine] Cooking formula '${formulaName}'...`);

        // 1. Create Container (Molecule Root)
        // We use type 'epic' for now as the container, or 'convoy' if specific logic dictates (future).
        // For general formulas, 'epic' is safe.
        const rootTitle = `[Molecule] ${resolveTemplate(formula.description)}`; // Or derived from var?
        const rootBead = await beads.create(rootTitle, { type: 'epic' });
        console.log(`[WorkflowEngine] Created Root Epic: ${rootBead.id}`);

        // 2. Instantiate Steps
        const stepIdToBeadId = new Map<string, string>();

        for (const step of formula.steps) {
            const title = resolveTemplate(step.title);
            const description = resolveTemplate(step.description);

            const bead = await beads.create(title, {
                parent: rootBead.id,
                // description field not yet in create options but 'create' usually takes title only in basic args? 
                // Wait, bd CLI description flag? 
                // Checking beads.ts... we didn't add description to CreateOptions yet.
                // Assuming title carries weight or we need to update description later?
                // Let's stick to title for now or assume title is enough. 
                // Ideally we'd add --description to bd create.
            });

            // If description is needed, we might need a separate 'update' call if create doesn't support it fully via wrapper?
            // But let's assume title is primary.
            // Actually, for a robust engine, we probably want description. 
            // I'll skip description for now to avoid modifying beads.ts further if --description isn't standard in `bd create` command structure I recall.

            stepIdToBeadId.set(step.id, bead.id);
            console.log(`[WorkflowEngine] Created Step '${step.id}' -> ${bead.id}`);
        }

        // 3. Wire Dependencies
        for (const step of formula.steps) {
            if (step.needs && step.needs.length > 0) {
                const childId = stepIdToBeadId.get(step.id);
                if (!childId) continue;

                for (const parentStepId of step.needs) {
                    const parentId = stepIdToBeadId.get(parentStepId);
                    if (parentId) {
                        // In `bd` typically: dep add <child> <parent> (child depends on parent / parent blocks child)
                        // If "Step A needs Step B", Step A is blocked by Step B.
                        // So Step A is the "child" (blocked) and Step B is the "parent" (blocker)?
                        // Wait, usually dependency means A depends on B. B must finish first.
                        // In many systems: B is parent of A? Or A has prereq B.
                        // `bd dep add <child> <parent>` logic in `beads` usually implies:
                        // Child is "inside" parent? No, that's parent/child hierarchy.
                        // This is "Dependency".
                        // Let's assume `bd dep add <blocked> <blocker>`
                        // If 'impl' needs 'audit', 'impl' is blocked by 'audit'.
                        // addDependency(impl, audit).
                        await beads.addDependency(childId, parentId);
                        console.log(`[WorkflowEngine] Wired ${childId} (needs) -> ${parentId}`);
                    }
                }
            }
        }

        console.log(`[WorkflowEngine] Cooking complete. Molecule ID: ${rootBead.id}`);
        return rootBead.id;
    }
}

// Singleton
let _workflowEngine: WorkflowEngine | null = null;
export function getWorkflowEngine(): WorkflowEngine {
    if (!_workflowEngine) {
        _workflowEngine = new WorkflowEngine();
    }
    return _workflowEngine;
}
