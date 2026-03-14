import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentRole } from "../config/schema";
import { getProjectContext } from "../services/project-context";
import { getPearls } from "./pearls";
import { getFormulaRegistry } from "./formula";
import { logger } from "./logger";
import { MCPResourceProvider } from "./mcp-resource-provider";
import { getGlobalSingleton } from "./registry";

export interface InstructionContext {
	role: AgentRole;
	pearlId?: string;
	labels?: string[];
	context?: Record<string, unknown>;
}

export interface InstructionProvider {
	name: string;
	priority: number; // Higher priority = appended later
	getInstructions(ctx: InstructionContext): Promise<string | null>;
}

/**
 * Loads project-specific top-level protocol from .citadel/instructions/protocol.md
 * This has the lowest priority value (5), meaning it appears at the very top.
 */
export class CustomProtocolProvider implements InstructionProvider {
	name = "custom-protocol";
	priority = 5;

	async getInstructions(_ctx: InstructionContext): Promise<string | null> {
		const path = resolve(process.cwd(), ".citadel/instructions/protocol.md");
		if (existsSync(path)) {
			try {
				const content = await readFile(path, "utf-8");
				return `# ⚠️ PROTOCOL (Highest Priority)\n${content}`;
			} catch (err) {
				logger.error(`[CustomProtocolProvider] Failed to read ${path}:`, err);
			}
		}
		return null;
	}
}

/**
 * Loads AGENTS.md from project root.
 */
export class GlobalProvider implements InstructionProvider {
	name = "global";
	priority = 10;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		const parts: string[] = [];

		// 1. Always load project-wide AGENTS.md as the foundation
		const projectContext = await getProjectContext().resolveContext(
			process.cwd(),
			process.cwd(),
		);
		if (projectContext) {
			parts.push(`# PROJECT RULES (AGENTS.md)
You must follow these rules from the project configuration:

## Raw Configuration
${projectContext.config.raw}

Always prioritize these project-specific instructions over general knowledge.`);
		}

		// 2. Additionally, load persona/assignee file if one exists (stacks on top of AGENTS.md)
		if (ctx.pearlId) {
			try {
				const pearl = await getPearls().get(ctx.pearlId);
				if (pearl.assignee) {
					const agentPath = resolve(process.cwd(), `agents/${pearl.assignee}.md`);
					if (existsSync(agentPath)) {
						const content = await readFile(agentPath, "utf-8");
						parts.push(`# AGENT PERSONA: ${pearl.assignee.toUpperCase()}
You are embodying the persona of ${pearl.assignee}. Adopt the following style and voice, while still adhering to the project rules above:

${content}`);
					}
				}
			} catch (err) {
				logger.warn(`[GlobalProvider] Error fetching assignee persona for ${ctx.pearlId}: ${err}`);
			}
		}

		return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
	}
}

/**
 * Hardcoded defaults for Citadel roles.
 * Provides a universal System Integrity block for all roles,
 * and a Worker base protocol for worker-type roles.
 */
export class BuiltinProvider implements InstructionProvider {
	name = "builtin";
	priority = 15;

	// Roles that derive from the worker base protocol
	private static readonly WORKER_TYPE_ROLES = [
		"worker",
		"software_developer",
		"qa",
		"product",
		"research",
	];

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		const parts: string[] = [];

		// --- Universal System Integrity Block (all roles) ---
		parts.push(`## System Integrity
- **Atomic Completion**: You are only considered "done" once you have called the appropriate completion tool matching your role (\`submit_work\`, \`approve_work\`, \`reject_work\`, or \`fail_work\`).`);

		// --- Worker Base Protocol (all worker-type roles) ---
		if (BuiltinProvider.WORKER_TYPE_ROLES.includes(ctx.role)) {
			parts.push(`## Worker Base Protocol

### Skills-First Workflow
Before reasoning from scratch, you MUST leverage the company's specialized skills library:
- **Discovery**: Use \`skills:list_skills\` to see available methodologies.
- **Utilization**: Use \`skills:get_skill\` to read the instructions for a relevant skill and follow them.

### Memory Retrieval
If no skill exists, use the QMD system:
- \`qmd:search\` for keyword lookup in \`memories/\` or \`docs/\`.
- \`qmd:vector_search\` for conceptual / semantic search.
- \`qmd:deep_search\` for highest quality historical context.

### Persistence & Git
- Every successful task must result in an atomic Git commit.
- Use descriptive messages: \`feat(role): summary [pearlId]\`.

### Escalation & Delegation
- You are NOT authorized to call \`escalate_to_human\` directly.
- Delegate to a C-level role (\`ceo\`, \`cto\`, or \`cfo\`) via \`delegate_task\` if human input is required.`);
		}

		if (ctx.role === "gatekeeper") {
			parts.push(`## Verification Mode
You are the Gatekeeper (Evaluator). Your purpose is to verify that the work meets the requirements. You MUST finalize with \`approve_work\`, \`reject_work\`, or \`fail_work\`.`);
		}

		return parts.length > 0 ? parts.join("\n\n") : null;
	}
}

/**
 * Loads role-specific instructions from .citadel/instructions/role-${role}.md
 */
export class RoleProvider implements InstructionProvider {
	name = "role";
	priority = 20;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		const path = resolve(
			process.cwd(),
			`.citadel/instructions/role-${ctx.role}.md`,
		);
		if (existsSync(path)) {
			try {
				return await readFile(path, "utf-8");
			} catch (err) {
				logger.error(`[RoleProvider] Failed to read ${path}:`, err);
			}
		}
		return null;
	}
}

/**
 * Loads instructions from Formula if the pearl is part of a formula.
 */
export class FormulaProvider implements InstructionProvider {
	name = "formula";
	priority = 30;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		if (!ctx.pearlId) return null;

		try {
			const pearl = await getPearls().get(ctx.pearlId);
			const formulaLabel = pearl.labels?.find((l) => l.startsWith("formula:"));
			if (!formulaLabel) return null;

			const formulaName = formulaLabel.split(":")[1];
			if (!formulaName) return null;
			const formula = getFormulaRegistry().get(formulaName);

			if (formula?.prompts) {
				const prompts = formula.prompts;
				return prompts[ctx.role] || null;
			}
		} catch (err) {
			logger.debug(`[FormulaProvider] Error fetching formula prompts: ${err}`);
		}
		return null;
	}
}

/**
 * Loads instructions based on tags (labels) like .citadel/instructions/tag-git.md
 */
export class TagProvider implements InstructionProvider {
	name = "tag";
	priority = 40;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		if (!ctx.labels || ctx.labels.length === 0) return null;

		const baseDir = resolve(process.cwd(), ".citadel/instructions");
		if (!existsSync(baseDir)) return null;

		const results: string[] = [];
		for (const label of ctx.labels) {
			const tagName = label.startsWith("tag:") ? label.split(":")[1] : label;
			const path = join(baseDir, `tag-${tagName}.md`);
			if (existsSync(path)) {
				try {
					const content = await readFile(path, "utf-8");
					results.push(`## TAG: ${tagName}\n${content}`);
				} catch (err) {
					logger.error(`[TagProvider] Failed to read ${path}:`, err);
				}
			}
		}

		return results.length > 0 ? results.join("\n\n") : null;
	}
}

/**
 * Loads custom instructions from pearl context.
 */
export class ContextProvider implements InstructionProvider {
	name = "context";
	priority = 50;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		if (ctx.context?.custom_instructions) {
			return `## DYNAMIC INSTRUCTIONS\n${ctx.context.custom_instructions}`;
		}
		return null;
	}
}

export class InstructionService {
	private providers: InstructionProvider[] = [];

	constructor() {
		this.providers = [
			new CustomProtocolProvider(),
			new GlobalProvider(),
			new BuiltinProvider(),
			new RoleProvider(),
			new MCPResourceProvider(),
			new FormulaProvider(),
			new TagProvider(),
			new ContextProvider(),
		].sort((a, b) => a.priority - b.priority);
	}

	async buildPrompt(
		ctx: InstructionContext,
		basePrompt: string,
	): Promise<string> {
		const additions: string[] = [];

		logger.debug(`[InstructionService] Building prompt for role ${ctx.role} with base prompt of ${basePrompt.length} chars`);
		for (const provider of this.providers) {
			try {
				const instructions = await provider.getInstructions(ctx);
				if (instructions) {
					logger.debug(`[InstructionService] Provider ${provider.name} added instructions ${instructions.length} chars`);
					additions.push(instructions);
				}
			} catch (err) {
				logger.error(
					`[InstructionService] Provider ${provider.name} failed:`,
					err,
				);
			}
		}

		if (additions.length === 0) return basePrompt;

		const finalPrompt = `
${basePrompt}

# ADDITIONAL INSTRUCTIONS
${additions.join("\n\n---\n\n")}
`;
		logger.debug(`[InstructionService] Final prompt ${finalPrompt.length} chars`);
		return finalPrompt;
	}
}

export function getInstructionService(): InstructionService {
	return getGlobalSingleton("instruction_service", () => new InstructionService());
}
