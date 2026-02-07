import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PearlsClient } from "../src/core/pearls";
import { resetConfig, setConfig } from "../src/config";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

describe("PearlsClient Shell Escaping", () => {
    const testDir = join(process.cwd(), "temp_test_escaping");

    beforeEach(async () => {
        resetConfig();
        setConfig({
            env: "development",
            providers: { ollama: {} },
            pearls: { path: join(testDir, ".pearls"), binary: "/Users/origo/.cargo/bin/prl" },
            agents: {
                worker: { provider: "ollama", model: "mock" },
                router: { provider: "ollama", model: "mock" },
                gatekeeper: { provider: "ollama", model: "mock" }
            },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 }
        });
        await mkdir(testDir, { recursive: true });
        const { execSync } = require("node:child_process");
        execSync("git init", { cwd: testDir });
        const client = new PearlsClient(join(testDir, ".pearls"));
        await client.init();
    });

    afterEach(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    it("should handle special characters in metadata (like **)", async () => {
        const client = new PearlsClient(join(testDir, ".pearls"));
        const pearl = await client.create("Test Pearl");

        // This is suspected to fail due to shell expansion or bad quoting
        const specialValue = "**Verify** this works";

        try {
            await client.update(pearl.id, {
                acceptance_test: specialValue
            });

            const updated = await client.get(pearl.id);
            expect(updated.acceptance_test).toBe(specialValue);
        } catch (error) {
            console.error("Caught error during update:", error);
            throw error;
        }
    });

    it("should handle quotes in metadata", async () => {
        const client = new PearlsClient(join(testDir, ".pearls"));
        const pearl = await client.create("Test Pearl");

        const valueWithQuotes = 'He said "Hello"';
        await client.update(pearl.id, {
            acceptance_test: valueWithQuotes
        });

        const updated = await client.get(pearl.id);
        expect(updated.acceptance_test).toBe(valueWithQuotes);
    });
});
