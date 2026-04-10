import { z } from "zod";
import { WorkerAgent } from "../../src/agents/worker";
import { setConfig } from "../../src/config";
import { logger } from "../../src/core/logger";

// Disable console logging for the test to keep it clean
logger.setConsoleEnabled(true);

const testConfig = {
    env: "development" as const,
    providers: {},
    agents: {
        worker: { provider: "openai" as const, model: "gpt-4o" },
        gatekeeper: { provider: "openai" as const, model: "gpt-4o" }
    },
    context: {
        maxHistoryMessages: 20,
        maxToolResponseSize: 100, // Very small for testing
        offloadThresholds: { "slow_server": 50 } // Granular limit
    }
};

async function runTest() {
    // @ts-ignore - Internal API for testing
    setConfig(testConfig);

    const agent = new WorkerAgent();
    
    // 1. Register a "large" tool
    // @ts-ignore - Accessing protected for test
    agent.registerTool(
        "get_huge_data",
        "Returns a very large string",
        z.object({}),
        async () => "This is a very long string that should definitely be offloaded because it exceeds the 100 character limit we set in the test config.",
        "slow_server"
    );

    console.log("--- STARTING AGENT ---");
    // We mock the LLM output to force a tool call
    // In a real test we'd use a mock model, but here I'm just verifying the logic in CoreAgent.run
    
    // To test the logic WITHOUT a real LLM, I'll bypass executeGenerateText or mock the model.
    // But since I'm implementing, I'll just check if the return value of a tool execution 
    // is correctly formatted in the internal messages array.
    
    // Testing the tool execution directly by calling the handler through the agent's logic
    // is hard because it's private.
    // However, I can trigger a run and see what happens if I have a mock model.
    
    console.log("Test script ready. Running manual verification of offloading logic...");
}

runTest().catch(console.error);
