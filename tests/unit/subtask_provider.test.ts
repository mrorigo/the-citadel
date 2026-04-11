import { test, expect, describe, spyOn } from "bun:test";
import { SubTaskProvider, type InstructionContext } from "../../src/core/instruction";
import { PearlsClient } from "../../src/core/pearls";

describe("SubTaskProvider", () => {
    test("should correctly format blocker instructions", async () => {
        // Mock PearlsClient
        const pearls = new PearlsClient("/tmp");
        const getAllSpy = spyOn(pearls, "getAll").mockImplementation(async () => [
            {
                id: "prl-blocker",
                title: "Blocker Task",
                status: "done",
                blockers: [],
                metadata: { output: "Blocker output" },
                created_at: "",
                updated_at: ""
            } as any,
            {
                id: "prl-target",
                title: "Target Task",
                status: "open",
                blockers: ["prl-blocker"],
                created_at: "",
                updated_at: ""
            } as any
        ]);

        const provider = new SubTaskProvider(pearls);
        const ctx: InstructionContext = {
            role: "worker" as any,
            pearlId: "prl-target"
        };

        const instructions = await provider.getInstructions(ctx);

        expect(instructions).toContain("## SUBTASK STATUS (BLOCKERS)");
        expect(instructions).toContain("#### SUBTASK: Blocker Task (ID: prl-blocker)");
        expect(instructions).toContain("Status: DONE");
        expect(instructions).toContain("Output: Blocker output");
        
        expect(getAllSpy).toHaveBeenCalled();
    });

    test("should return null if no blockers", async () => {
        const pearls = new PearlsClient("/tmp");
        spyOn(pearls, "getAll").mockImplementation(async () => [
            {
                id: "prl-target",
                title: "Target Task",
                status: "open",
                blockers: [],
                created_at: "",
                updated_at: ""
            } as any
        ]);

        const provider = new SubTaskProvider(pearls);
        const ctx: InstructionContext = {
            role: "worker" as any,
            pearlId: "prl-target"
        };

        const instructions = await provider.getInstructions(ctx);
        expect(instructions).toBeNull();
    });

    test("should return null if pearlId is missing", async () => {
        const provider = new SubTaskProvider();
        const instructions = await provider.getInstructions({ role: "worker" as any });
        expect(instructions).toBeNull();
    });
});
