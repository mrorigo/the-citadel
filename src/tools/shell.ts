import { spawn } from "node:child_process";
import { z } from "zod";
import { getConfig } from "../config";
import { getPearls } from "../core/pearls";
import { logger } from "../core/logger";

export const runCommandTool = {
	name: "run_command",
	description: "Execute a shell command (e.g. to run tests). Supports timeouts and background execution.",
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
			timeout: z
				.number()
				.optional()
				.default(60000)
				.describe("Timeout in milliseconds (default: 60000)"),
			background: z
				.boolean()
				.optional()
				.default(false)
				.describe("Whether to run the command in the background (default: false)"),
		})
		.loose(),
	handler: async (args: {
		command?: string | string[];
		cmd?: string | string[];
		timeout?: number;
		background?: boolean;
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

		const timeout = args.timeout ?? 60000;
		const background = args.background === true;

		logger.debug(`[Shell] Running command: ${command} (timeout: ${timeout}, background: ${background})`);

		if (background) {
			try {
				const child = spawn(command, {
					shell: true,
					detached: true,
					stdio: 'ignore',
				});
				child.unref();

				return {
					success: true,
					message: `Started background process with PID ${child.pid}`,
					pid: child.pid,
				};
			} catch (error: unknown) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}

		return new Promise((resolve) => {
			const child = spawn(command!, { shell: true });
			let stdout = "";
			let stderr = "";

			const timer = setTimeout(() => {
				// Kill the process group if it hangs
				try {
					// On Unix, prepending '-' to the pid kills the process group
					process.kill(-child.pid!, 'SIGTERM');
				} catch (e) {
					child.kill('SIGTERM');
				}

				resolve({
					success: false,
					error: `Command timed out after ${timeout}ms`,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
				});
			}, timeout);

			child.stdout?.on("data", (data) => {
				stdout += data.toString();
			});

			child.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			child.on("close", async (code) => {
				clearTimeout(timer);

				// Post-Git Sync
				if (command!.trim().startsWith("git ")) {
					let autoSync = true;
					try {
						const config = getConfig();
						autoSync = config.pearls.autoSync !== false;
					} catch {
						/* ignore */
					}

					if (autoSync) {
						logger.info(`[Shell] Git operation detected. Triggering Pearls sync.`);
						await getPearls().sync();
					}
				}

				if (code === 0) {
					resolve({
						success: true,
						stdout: stdout.trim(),
						stderr: stderr.trim(),
					});
				} else {
					resolve({
						success: false,
						error: `Command exited with code ${code}`,
						stdout: stdout.trim(),
						stderr: stderr.trim(),
					});
				}
			});

			child.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					success: false,
					error: err.message,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
				});
			});
		});
	},
};
