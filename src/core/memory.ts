import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { getGlobalSingleton } from "./registry";

export class ToolResultMemory {
	private baseDir: string;

	constructor(baseDir = ".citadel/tool-results") {
		this.baseDir = baseDir;
	}

	private async ensureDir(pearlId: string): Promise<string> {
		const dir = join(process.cwd(), this.baseDir, pearlId);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
		return dir;
	}

	async store(pearlId: string, content: string): Promise<string> {
		const id = randomUUID();
		const dir = await this.ensureDir(pearlId);
		const filePath = join(dir, `${id}.json`);

		const data = {
			id,
			pearlId,
			timestamp: new Date().toISOString(),
			content,
		};

		await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		logger.debug(`[Memory] Stored tool result ${id} for pearl ${pearlId}`);
		return id;
	}

	async get(pearlId: string, id: string): Promise<string | null> {
		const filePath = join(process.cwd(), this.baseDir, pearlId, `${id}.json`);
		if (!existsSync(filePath)) {
			logger.warn(`[Memory] Tool result ${id} not found for pearl ${pearlId}`);
			return null;
		}

		try {
			const raw = await readFile(filePath, "utf-8");
			const data = JSON.parse(raw);
			return data.content || null;
		} catch (err) {
			logger.error(`[Memory] Failed to read tool result ${id}:`, err);
			return null;
		}
	}
}

export function getToolResultMemory(): ToolResultMemory {
	return getGlobalSingleton("tool_result_memory", () => new ToolResultMemory());
}
