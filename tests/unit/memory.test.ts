import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getToolResultMemory } from "../../src/core/memory";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("ToolResultMemory", () => {
	const memory = getToolResultMemory();
	const testPearlId = "test-pearl-123";

	afterAll(async () => {
		const dir = join(process.cwd(), ".citadel/tool-results", testPearlId);
		if (existsSync(dir)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("should store and retrieve large tool results", async () => {
		const largeContent = "A".repeat(10000);
		const id = await memory.store(testPearlId, largeContent);
		expect(id).toBeDefined();
		expect(id.length).toBeGreaterThan(0);

		const retrieved = await memory.get(testPearlId, id);
		expect(retrieved).toBe(largeContent);
	});

	it("should return null for non-existent results", async () => {
		const retrieved = await memory.get(testPearlId, "non-existent-id");
		expect(retrieved).toBeNull();
	});
});
