import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentRole } from "../config/schema";
import { getProjectContext } from "../services/project-context";
import { getBeads } from "./beads";
import { getFormulaRegistry } from "./formula";
import { logger } from "./logger";
import { MCPResourceProvider } from "./mcp-resource-provider";

export interface InstructionContext {
	role: AgentRole;
	beadId?: string;
	labels?: string[];
	context?: Record<string, unknown>;
}

export interface InstructionProvider {
	name: string;
	priority: number; // Higher priority = appended later
	getInstructions(ctx: InstructionContext): Promise<string | null>;
}

/**
 * Loads AGENTS.md from project root.
 */
export class GlobalProvider implements InstructionProvider {
	name = "global";
	priority = 10;

	async getInstructions(_ctx: InstructionContext): Promise<string | null> {
		const projectContext = await getProjectContext().resolveContext(
			process.cwd(),
			process.cwd(),
		);
		if (!projectContext) return null;

		return `
# PROJECT RULES (AGENTS.md)
You must follow these rules from the project configuration:

## Raw Configuration
${projectContext.config.raw}

Always prioritize these project-specific instructions over general knowledge.
`;
	}
}

/**
 * Hardcoded defaults for Citadel roles.
 */
export class BuiltinProvider implements InstructionProvider {
	name = "builtin";
	priority = 15;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		if (ctx.role === "worker") {
			return `
# Implementation Mode
You are the Worker. Your primary goal is to write code and fix issues.

# Filesystem Tools
You have access to the \`filesystem\` MCP server tools.
- Use \`filesystem_list_directory\` and \`filesystem_read_text_file\` to explore.
- Use \`filesystem_write_file\` to create or overwrite files.
- Use \`filesystem_edit_file\` for precise modifications.

# Persistence Rules
- **Persistence is Mandatory**: You MUST use \`filesystem_write_file\` or \`filesystem_edit_file\` to apply your changes to the disk. 
- **No Fake Completion**: Do NOT call \`submit_work\` and say "I have fixed it" unless you have successfully called the filesystem tools in this turn.
- **Verify Before Submission**: Always run tests or list the directory after your changes to confirm they were successful.
`;
		}

		if (ctx.role === "router") {
			return `
# Routing Mode
You are the Router Agent. Your purpose is to route tasks to the correct agent queue.

# Routing Rules (CRITICAL)
- Tasks with status='open' → enqueue_task with queue='worker'
- Tasks with status='verify' → enqueue_task with queue='gatekeeper'
- ALWAYS specify the queue parameter explicitly in enqueue_task
`;
		}

		if (ctx.role === "gatekeeper") {
			return `
# Verification Mode
You are the Gatekeeper (Evaluator). Your purpose is to verify that the work meets the requirements.
`;
		}

		return null;
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
 * Loads instructions from Formula if the bead is part of a formula.
 */
export class FormulaProvider implements InstructionProvider {
	name = "formula";
	priority = 30;

	async getInstructions(ctx: InstructionContext): Promise<string | null> {
		if (!ctx.beadId) return null;

		try {
			const bead = await getBeads().get(ctx.beadId);
			const formulaLabel = bead.labels?.find((l) => l.startsWith("formula:"));
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
 * Loads custom instructions from bead context.
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

		for (const provider of this.providers) {
			try {
				const instructions = await provider.getInstructions(ctx);
				if (instructions) {
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

		return `
${basePrompt}

# ADDITIONAL INSTRUCTIONS
${additions.join("\n\n---\n\n")}
`;
	}
}

let _instance: InstructionService | null = null;
export function getInstructionService(): InstructionService {
	if (!_instance) {
		_instance = new InstructionService();
	}
	return _instance;
}
