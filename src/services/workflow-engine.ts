import { getPearls, type PearlsClient } from "../core/pearls";
import { type FormulaRegistry, getFormulaRegistry } from "../core/formula";
import { getConfig } from "../config";

export class WorkflowEngine {
	private registry: FormulaRegistry;
	private pearls: PearlsClient;

	constructor(registry?: FormulaRegistry, pearls?: PearlsClient) {
		this.registry = registry || getFormulaRegistry();
		this.pearls = pearls || getPearls();
	}

	async init() {
		await this.registry.loadAll();
	}

	/**
	 * "Cooks" a Formula into a Molecule (a graph of Pearls).
	 * 1. Creates Root Convoy/Epic.
	 * 2. Iterates steps, resolving variables.
	 * 3. Creates Pearls for steps.
	 * 4. Wires dependencies.
	 */
	async instantiateFormula(
		formulaName: string,
		variables: Record<string, string>,
		parentContextId?: string,
	): Promise<string> {
		const formula = this.registry.get(formulaName);
		if (!formula) {
			throw new Error(`Formula not found: ${formulaName}`);
		}

		const resolveTemplate = (
			tpl: string,
			extraVars: Record<string, string> = {},
		) => {
			let result = tpl;
			const context = { ...variables, ...extraVars };
			for (const [key, val] of Object.entries(context)) {
				result = result.replace(new RegExp(`{{${key}}}`, "g"), val);
			}
			return result;
		};

		const evaluateCondition = (
			condition: string,
			extraVars: Record<string, string> = {},
		): boolean => {
			// Simple string comparison for now: "val == val" or "val != val"
			const resolved = resolveTemplate(condition, extraVars).trim();

			if (resolved.includes("==")) {
				const [left, right] = resolved
					.split("==")
					.map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
				return left === right;
			}
			if (resolved.includes("!=")) {
				const [left, right] = resolved
					.split("!=")
					.map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
				return left !== right;
			}
			// Boolean checks if strictly "true" or "false"
			if (resolved === "true") return true;
			if (resolved === "false") return false;

			// Default to true if not strictly parsed? Or false?
			// For safety, warn and return false if complex.
			console.warn(
				`[WorkflowEngine] Could not parse condition: ${condition} (resolved: ${resolved})`,
			);
			return false;
		};

		const pearls = this.pearls;

		console.log(`[WorkflowEngine] Cooking formula '${formulaName}'...`);

		const rootTitle = `[Molecule] ${resolveTemplate(formula.description)}`;
		const rootPearl = await pearls.create(rootTitle, {
			type: "epic",
			parent: parentContextId,
		});
		console.log(
			`[WorkflowEngine] Created Root Epic: ${rootPearl.id}${parentContextId ? ` in Convoy ${parentContextId}` : ""}`,
		);

		// Track StepID -> Array of PearlIDs (for One-to-Many loops)
		const stepIdToPearlIds = new Map<string, string[]>();

		for (const step of formula.steps) {
			// 1. Check Condition
			if (step.if) {
				if (!evaluateCondition(step.if)) {
					console.log(
						`[WorkflowEngine] Skipping Step '${step.id}' (condition '${step.if}' false)`,
					);
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
					if (listString.startsWith("[")) {
						items = JSON.parse(listString);
					} else {
						items = listString
							.split(",")
							.map((s) => s.trim())
							.filter((s) => !!s);
					}

					if (Array.isArray(items)) {
						iterations = items.map((item) => ({
							[step.for?.as || "item"]: item,
						}));
					}
				} catch (e) {
					console.error(
						`[WorkflowEngine] Failed to parse loop items for step ${step.id}: ${e}`,
					);
					continue;
				}
			}

			const createdIds: string[] = [];

			for (const iterContext of iterations) {
				const title = resolveTemplate(step.title, iterContext);
				const description = resolveTemplate(step.description, iterContext);

				const finalContext: Record<string, any> = { ...variables, ...(step.context || {}), ...iterContext };

				if (formula.context_files?.length) {
					finalContext.context_files = formula.context_files.join(', ');
				}

				const pearl = await pearls.create(title, {
					parent: rootPearl.id,
					description: description,
					context: finalContext, // Merged context (now including formula-level variables)
					labels: [
						...(step.labels || []),
						`step:${step.id}`,
						`formula:${formulaName}`,
						"molecule:cooking",
					],
					assignee: step.agent, // Assign specific agent role if defined
				});

				createdIds.push(pearl.id);
				console.log(
					`[WorkflowEngine] Created Step '${step.id}' -> ${pearl.id} (context: ${JSON.stringify(iterContext)})`,
				);
			}

			if (createdIds.length > 0) {
				stepIdToPearlIds.set(step.id, createdIds);
			}
		}

		// 3. Wire Dependencies
		for (const step of formula.steps) {
			const childIds = stepIdToPearlIds.get(step.id);
			if (!childIds) continue;

			// Wire 'needs' (Blocking)
			if (step.needs && step.needs.length > 0) {
				for (const parentStepId of step.needs) {
					const parentIds = stepIdToPearlIds.get(parentStepId);
					if (parentIds) {
						for (const childId of childIds) {
							for (const parentId of parentIds) {
								await pearls.addDependency(childId, parentId);
								console.log(
									`[WorkflowEngine] Wired ${childId} (needs) -> ${parentId}`,
								);
							}
						}
					}
				}
			}

			// Wire 'on_failure' (Recovery)
			// Semantic: "Step A on_failure Step B" => B depends on A, but runs ONLY if A fails.
			if (step.on_failure) {
				const recoveryIds = stepIdToPearlIds.get(step.on_failure);
				if (recoveryIds) {
					for (const childId of childIds) {
						for (const recId of recoveryIds) {
							// Recovery step (recId) blocked by Main step (childId)
							await pearls.addDependency(recId, childId);
							// Flag recovery pearl and link it to its source for traceability
							await pearls.update(recId, {
								labels: ["recovery", `recovers:${childId}`],
							});
							console.log(
								`[WorkflowEngine] Wired ${recId} (recovery) -> ${childId}`,
							);
						}
					}
				}
			}
		}

		// 4. Release Pearls (Remove 'molecule:cooking')
		console.log(`[WorkflowEngine] Wiring complete. Releasing pearls...`);
		const allCreatedIds = Array.from(stepIdToPearlIds.values()).flat();
		for (const id of allCreatedIds) {
			await pearls.update(id, {
				// @ts-expect-error
				remove_labels: ["molecule:cooking"],
			});
		}

		console.log(
			`[WorkflowEngine] Cooking complete. Molecule ID: ${rootPearl.id}`,
		);

		// Execute onMoleculeStart lifecycle hook
		const config = getConfig();
		if (config.hooks?.onMoleculeStart) {
			try {
				await config.hooks.onMoleculeStart(rootPearl, formula, variables);
			} catch (err) {
				console.error("[WorkflowEngine] Error in onMoleculeStart hook:", err);
			}
		}

		return rootPearl.id;
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
