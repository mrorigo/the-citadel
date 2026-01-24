
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
    async instantiateFormula(formulaName: string, variables: Record<string, string>, parentContextId?: string): Promise<string> {
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
        // A Molecule is represented as an standard 'Epic' bead.
        const rootTitle = `[Molecule] ${resolveTemplate(formula.description)}`;
        const rootBead = await beads.create(rootTitle, {
            type: 'epic',
            parent: parentContextId
        });
        console.log(`[WorkflowEngine] Created Root Epic: ${rootBead.id}${parentContextId ? ` in Convoy ${parentContextId}` : ''}`);

        // 2. Instantiate Steps
        const stepIdToBeadId = new Map<string, string>();

        for (const step of formula.steps) {
            const title = resolveTemplate(step.title);
            const description = resolveTemplate(step.description);

            const bead = await beads.create(title, {
                parent: rootBead.id,
                description: description
            });

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
                        // Semantic: "Step A needs Step B" => A is blocked by B.
                        // `bd dep add <blocked> <blocker>`
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
