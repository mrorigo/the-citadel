import { describe, it, expect } from "bun:test";
import { runCommandTool } from "../../src/tools/shell";
import { execSync } from "node:child_process";

describe("run_command Background", () => {
    it("should start a background process and return PID", async () => {
        const result = await runCommandTool.handler({
            command: "sleep 10",
            background: true
        }) as any;

        expect(result.success).toBe(true);
        expect(result.pid).toBeDefined();
        expect(typeof result.pid).toBe("number");

        // Verify process exists
        try {
            execSync(`ps -p ${result.pid}`);
        } catch (e) {
            throw new Error(`Process with PID ${result.pid} not found`);
        }

        // Cleanup
        process.kill(result.pid, 'SIGTERM');
    });
});
