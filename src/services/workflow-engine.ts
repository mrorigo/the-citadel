
import { getBeads } from '../core/beads';
import { getFormulaRegistry, type FormulaRegistry } from '../core/formula';

export class WorkflowEngine {
    private registry: FormulaRegistry;

    constructor(registry?: FormulaRegistry) {
        this.registry = registry || getFormulaRegistry();
    }

    async init() {
        await this.registry.loadAll();
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
                if (!variables[key] && config.default) {
                    variables[key] = config.default;
                }
            }
        }

        const resolveTemplate = (tpl: string, extraVars: Record<string, string> = {}) => {
            let result = tpl;
            const context = { ...variables, ...extraVars };
            for (const [key, val] of Object.entries(context)) {
                result = result.replace(new RegExp(`{{${key}}}`, 'g'), val);
            }
            return result;
        };

        const evaluateCondition = (condition: string, extraVars: Record<string, string> = {}): boolean => {
            // Simple string comparison for now: "val == val" or "val != val"
            const resolved = resolveTemplate(condition, extraVars).trim();

            if (resolved.includes('==')) {
                const [left, right] = resolved.split('==').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
                return left === right;
            }
            if (resolved.includes('!=')) {
                const [left, right] = resolved.split('!=').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
                return left !== right;
            }
            // Boolean checks if strictly "true" or "false"
            if (resolved === 'true') return true;
            if (resolved === 'false') return false;

            // Default to true if not strictly parsed? Or false? 
            // For safety, warn and return false if complex.
            console.warn(`[WorkflowEngine] Could not parse condition: ${condition} (resolved: ${resolved})`);
            return false;
        };

        const beads = getBeads();

        console.log(`[WorkflowEngine] Cooking formula '${formulaName}'...`);

        const rootTitle = `[Molecule] ${resolveTemplate(formula.description)}`;
        const rootBead = await beads.create(rootTitle, {
            type: 'epic',
            parent: parentContextId
        });
        console.log(`[WorkflowEngine] Created Root Epic: ${rootBead.id}${parentContextId ? ` in Convoy ${parentContextId}` : ''}`);

        // Track StepID -> Array of BeadIDs (for One-to-Many loops)
        const stepIdToBeadIds = new Map<string, string[]>();

        for (const step of formula.steps) {
            // 1. Check Condition
            if (step.if) {
                if (!evaluateCondition(step.if)) {
                    console.log(`[WorkflowEngine] Skipping Step '${step.id}' (condition '${step.if}' false)`);
                    continue;
                }
            }

            // 2. Determine Iteration (Loop vs Single)
            let iterations: Array<Record<string, string>> = [{}]; // Default single iteration
            if (step.for) {
                const listString = resolveTemplate(step.for.items);
                try {
                    // Try parsing as JSON array
                    let items: string[] = [];
                    // Handle comma-separated list or JSON
                    if (listString.startsWith('[')) {
                        items = JSON.parse(listString);
                    } else {
                        items = listString.split(',').map(s => s.trim()).filter(s => !!s);
                    }

                    if (Array.isArray(items)) {
                        iterations = items.map(item => ({ [step.for?.as || 'item']: item }));
                    }
                } catch (e) {
                    console.error(`[WorkflowEngine] Failed to parse loop items for step ${step.id}: ${e}`);
                    continue;
                }
            }

            const createdIds: string[] = [];

            for (const iterContext of iterations) {
                const title = resolveTemplate(step.title, iterContext);
                const description = resolveTemplate(step.description, iterContext);

                const bead = await beads.create(title, {
                    parent: rootBead.id,
                    description: description
                });

                createdIds.push(bead.id);
                console.log(`[WorkflowEngine] Created Step '${step.id}' -> ${bead.id} (context: ${JSON.stringify(iterContext)})`);
            }

            if (createdIds.length > 0) {
                stepIdToBeadIds.set(step.id, createdIds);
            }
        }

        // 3. Wire Dependencies
        for (const step of formula.steps) {
            const childIds = stepIdToBeadIds.get(step.id);
            if (!childIds) continue;

            // Wire 'needs' (Blocking)
            if (step.needs && step.needs.length > 0) {
                for (const parentStepId of step.needs) {
                    const parentIds = stepIdToBeadIds.get(parentStepId);
                    if (parentIds) {
                        for (const childId of childIds) {
                            for (const parentId of parentIds) {
                                await beads.addDependency(childId, parentId);
                                console.log(`[WorkflowEngine] Wired ${childId} (needs) -> ${parentId}`);
                            }
                        }
                    }
                }
            }

            // Wire 'on_failure' (Recovery)
            // Semantic: "Step A on_failure Step B" => B depends on A, but runs ONLY if A fails?
            // Current Beads primitives support: B blocked by A.
            // If A fails, B becomes unblocked (if verify fail -> open?).
            // Actually, usually B waits for A to be DONE.
            // If A fails, we need logic.
            // For now, we wire it as a dependency + add a label "recovery".
            // The Conductor would need to know to SKIP B if A succeeds.
            if (step.on_failure) {
                const recoveryIds = stepIdToBeadIds.get(step.on_failure);
                if (recoveryIds) {
                    for (const childId of childIds) {
                        for (const recId of recoveryIds) {
                            // Recovery step (recId) blocked by Main step (childId)
                            await beads.addDependency(recId, childId);
                            // Flag recovery bead
                            await beads.update(recId, { status: 'open' }); // Ensure open? 
                            // Add 'recovery' label via update? beads.update doesn't support addLabel yet directly in interface but cli does.
                            // We assume primitive wiring for now. 
                            console.log(`[WorkflowEngine] Wired ${recId} (recovery) -> ${childId}`);
                        }
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
