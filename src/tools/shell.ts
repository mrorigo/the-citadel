import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { getConfig } from "../config";
import { getBeads } from "../core/beads";
import { logger } from "../core/logger";

const execAsync = promisify(exec);

export const runCommandTool = {
	name: "run_command",
	description: "Execute a shell command (e.g. to run tests)",
	schema: z
		.object({
			command: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe(
					'The shell command to execute as a single string (e.g., "ls -la", "npm test")',
				),
			cmd: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe("Alternative: command as string or array of arguments"),
		})
		.loose(),
	handler: async (args: {
		command?: string | string[];
		cmd?: string | string[];
		[key: string]: unknown;
	}) => {
		// Normalize: accept both 'command' and 'cmd', convert arrays to strings
		let command: string | undefined;
		if (args.command) {
			command = Array.isArray(args.command)
				? args.command.join(" ")
				: args.command;
		} else if (args.cmd) {
			command = Array.isArray(args.cmd) ? args.cmd.join(" ") : args.cmd;
		}

		if (!command) {
			return {
				success: false,
				error: 'Either "command" or "cmd" parameter must be provided',
			};
		}

		logger.debug(`[Shell] Running command: ${command}`);

		try {
			const { stdout, stderr } = await execAsync(command);

			// Post-Git Sync
			if (command.trim().startsWith("git ")) {
				let autoSync = true;
				try {
					const config = getConfig();
					autoSync = config.beads.autoSync !== false;
				} catch {
					/* ignore */
				}

				if (autoSync) {
					logger.info(`[Shell] Git operation detected. Triggering Beads sync.`);
					await getBeads().sync();
				}
			}

			return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			// Try to extract stdout/stderr from error object if available (exec error)
			const errObj = error as { stdout?: string; stderr?: string };

			return {
				success: false,
				error: errorMessage,
				stdout: errObj.stdout,
				stderr: errObj.stderr,
			};
		}
	},
};
