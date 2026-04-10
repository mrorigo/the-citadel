import type { Pearl } from "../core/pearls";
import { getPearls } from "../core/pearls";
import { logger } from "../core/logger";
import { getQueue } from "../core/queue";

export class DataPiper {
	private pearls: import("../core/pearls").PearlsClient;

	constructor(pearls?: import("../core/pearls").PearlsClient) {
		this.pearls = pearls || getPearls();
	}

	/**
	 * Attempts to pipe data into a Pearl's context from its dependencies.
	 * key logic:
	 * 1. Check if pearl has 'context' (we need to parse it from description if not stored separately in memory yet,
	 *    but pearls client handles this?)
	 *    Actually, PearlsClient parse logic extracts context.
	 * 2. If valid context found, scan values for {{steps.ID.output...}} patterns.
	 * 3. Fetch outputs for referenced steps.
	 * 4. Resolve values.
	 * 5. Update pearl context.
	 */
	async pipeData(pearlId: string): Promise<boolean> {
		try {
			const pearls = this.pearls;
			const pearl = await pearls.get(pearlId);
			if (!pearl || !pearl.context) return false;

			let hasChanges = false;
			const newContext: Record<string, unknown> = {
				...(pearl.context as Record<string, unknown>),
			};

			// Helper to traverse object and resolve strings
			const resolveObject = async (
				obj: Record<string, unknown>,
			): Promise<boolean> => {
				let changed = false;
				for (const key in obj) {
					const val = obj[key];
					if (typeof val === "string" && val.includes("{{")) {
						const resolved = await this.resolveTemplate(val, pearl);
						if (resolved !== val) {
							obj[key] = resolved;
							changed = true;
						}
					} else if (typeof val === "object" && val !== null) {
						if (await resolveObject(val as Record<string, unknown>))
							changed = true;
					}
				}
				return changed;
			};

			hasChanges = await resolveObject(newContext);

			if (hasChanges) {
				logger.info(`[Piper] Resolved data for pearl ${pearlId}`, { newContext });
				await this.pearls.update(pearlId, { context: newContext });
				return true;
			}

			return false;
		} catch (error) {
			logger.error(`[Piper] Failed to pipe data for ${pearlId}`, error);
			return false;
		}
	}

	private async resolveTemplate(
		template: string,
		pearl: Pearl,
	): Promise<unknown> {
		// Regex for {{steps.ID.output.KEY}}
		// Also support {{steps.ID.output}} (full object)

		// Check for full replacement first (if the string is EXACTLY the template)
		// allowing us to inject objects/arrays, not just strings.
		const fullMatch = template.match(/^{{steps\.([^.]+)\.output(?:\.(.+))?}}$/);
		if (fullMatch) {
			const stepId = fullMatch[1];
			const path = fullMatch[2];
			if (stepId) {
				return await this.fetchValue(pearl, stepId, path);
			}
		}

		// Partial replacement (string interpolation)
		// "Title: {{steps.foo.output.title}}"
		return template.replace(
			/{{steps\.([^.]+)\.output(?:\.(.+))?}}/g,
			(_match, _stepId, _path) => {
				// We can't support async inside replace easily without specific patterns,
				// but since we are doing one pass, we might have to fetch first.
				// Actually, simplest is to use a replacer that returns a placeholder?
				// No, let's just resolve one by one.
				// For now, let's limit support to FULL replacement or assume simple strings for partials.
				// WARN: Synchronous replace with async fetch is hard.
				// Let's iterate matches.
				return _match; // Placeholder, see logic below
			},
		);
	}

	// Simplified: Only support FULL property replacement for V1.
	// "key": "{{steps.foo.output.bar}}"
	// Mixed interpolation "Hello {{...}}" is harder with async resolution and types.

	private async fetchValue(
		currentPearl: Pearl,
		targetStepId: string,
		outputKey?: string,
	): Promise<unknown> {
		// 1. Find the target pearl ID.
		// Use logic: "Which dependency was created from stepId?"
		// Assumption: The WorkflowEngine adds a label `step:ID`.

		// Find dependency with label `step:{targetStepId}`
		const dependencyId = await this.findDependencyIdByStep(
			currentPearl,
			targetStepId,
		);

		if (!dependencyId) {
			logger.warn(
				`[Piper] Could not find dependency for step '${targetStepId}' in pearl ${currentPearl.id}`,
			);
			return `{{steps.${targetStepId}.output...}}`; // Unresolved
		}

		const queue = getQueue();

		// Try getting output from Pearl metadata first (Canonical Source)
		// This avoids the issue where Gatekeeper tickets (which return null output)
		// shadow the actual Worker ticket output in the Queue.
		const targetPearl = await this.pearls.get(dependencyId);
		let output = targetPearl.output;

		// Fallback to Queue (Legacy/Retry support)
		if (!output) {
			output = await queue.getOutput(dependencyId);
		}

		if (!output) return null;

		if (!outputKey) return output;

		// Deep access
		return outputKey
			.split(".")
			.reduce(
				(o: Record<string, unknown> | null, k) =>
					o ? (o[k] as Record<string, unknown> | null) : null,
				output as Record<string, unknown> | null,
			);
	}

	private async findDependencyIdByStep(
		currentPearl: Pearl,
		stepId: string,
	): Promise<string | undefined> {
		const pearls = this.pearls;
		const candidateIds = currentPearl.blockers || [];

		// 1. Check immediate blockers
		for (const id of candidateIds) {
			const pearl = await pearls.get(id);
			if (pearl.labels?.includes(`step:${stepId}`)) {
				return id;
			}
		}

		// 2. Deep Search: Check siblings in the same molecule (same parent)
		if (currentPearl.parent) {
			logger.debug(`[Piper] Shallow search failed for step:${stepId} in ${currentPearl.id}. Performing deep search...`);
			const allPearls = await pearls.getAll();
			const sibling = allPearls.find((p) =>
				p.parent === currentPearl.parent &&
				p.labels?.includes(`step:${stepId}`)
			);
			if (sibling) {
				return sibling.id;
			}
		}

		return undefined;
	}
}

import { getGlobalSingleton } from "../core/registry";

// Singleton
export function getPiper(pearls?: import("../core/pearls").PearlsClient): DataPiper {
	return getGlobalSingleton("piper", () => new DataPiper(pearls));
}
