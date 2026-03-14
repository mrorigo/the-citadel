import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	meta?: Record<string, unknown>;
}

export interface LoggerOptions {
	path?: string;
	level?: LogLevel;
	fileEnabled?: boolean;
	consoleEnabled?: boolean;
	rotation?: "daily" | "none";
}

export class CitadelLogger extends EventEmitter {
	private consoleEnabled = true;
	private fileEnabled = false;
	private filePath?: string;
	private rotation: "daily" | "none" = "none";
	private lastRotationCheck: string = new Date().toISOString().split("T")[0]!;

	setOptions(options: LoggerOptions) {
		if (options.consoleEnabled !== undefined) this.consoleEnabled = options.consoleEnabled;
		if (options.fileEnabled !== undefined) this.fileEnabled = options.fileEnabled;
		if (options.path !== undefined) this.filePath = options.path;
		if (options.rotation !== undefined) this.rotation = options.rotation;

		if (this.fileEnabled && this.filePath) {
			const dir = dirname(this.filePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
		}
	}

	setConsoleEnabled(enabled: boolean) {
		this.consoleEnabled = enabled;
	}

	debug(message: string, meta?: Record<string, unknown>) {
		this.log("debug", message, meta);
	}

	info(message: string, meta?: Record<string, unknown>) {
		this.log("info", message, meta);
	}

	warn(message: string, meta?: Record<string, unknown>) {
		this.log("warn", message, meta);
	}

	error(message: string, error?: unknown, meta?: Record<string, unknown>) {
		const errMeta =
			error instanceof Error
				? { error: error.message, stack: error.stack }
				: { error };
		this.log("error", message, { ...meta, ...errMeta });
	}

	private log(
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	) {
		const now = new Date();
		const timestamp = now.toISOString();
		const entry: LogEntry = { timestamp, level, message, meta };

		// Emit for Bridge/TUI
		this.emit("log", entry);

		const metaStr = meta ? JSON.stringify(meta) : "";
		const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`;

		// Print to console if enabled
		if (this.consoleEnabled) {
			const logFn = console[level] || console.log;

			if (
				level === "debug" &&
				process.env.NODE_ENV !== "development" &&
				!process.env.DEBUG
			) {
				// skip console debug if not enabled via env
			} else {
				logFn(logLine);
			}
		}

		// Write to file if enabled
		if (this.fileEnabled && this.filePath) {
			this.ensureRotation(now);
			try {
				appendFileSync(this.filePath, `${logLine}\n`);
			} catch (err) {
				console.error(`[Logger] Failed to write to log file: ${err}`);
			}
		}
	}

	private ensureRotation(now: Date) {
		if (this.rotation !== "daily" || !this.filePath) return;

		const today = now.toISOString().split("T")[0]!;
		if (this.lastRotationCheck !== today) {
			// Rotate
			if (existsSync(this.filePath)) {
				const rotatedPath = `${this.filePath}.${this.lastRotationCheck}`;
				try {
					renameSync(this.filePath, rotatedPath);
				} catch (err) {
					console.error(`[Logger] Log rotation failed: ${err}`);
				}
			}
			this.lastRotationCheck = today;
		}
	}
}

export const logger = new CitadelLogger();
