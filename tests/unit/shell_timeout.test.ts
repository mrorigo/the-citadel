import { describe, it, expect } from "bun:test";
import { runCommandTool } from "../../src/tools/shell";

describe("run_command Timeout", () => {
    it("should timeout a long running command", async () => {
        const start = Date.now();
        const result = await runCommandTool.handler({
            command: "sleep 2",
            timeout: 500
        }) as any;
        const end = Date.now();

        expect(result.success).toBe(false);
        expect(result.error).toContain("timed out");
        expect(end - start).toBeLessThan(1500); // Should definitely be less than the 2s sleep
    });

    it("should capture partial output before timeout", async () => {
        const result = await runCommandTool.handler({
            command: "echo 'hello'; sleep 2; echo 'world'",
            timeout: 500
        }) as any;

        expect(result.success).toBe(false);
        expect(result.stdout).toContain("hello");
        expect(result.stdout).not.toContain("world");
    });
});
