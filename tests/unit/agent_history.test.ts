import { describe, it, expect, beforeEach } from "bun:test";
import { CoreAgent } from "../../src/core/agent";
import { setConfig, resetConfig } from "../../src/config";
import type { ModelMessage } from "ai";

class TestAgent extends CoreAgent {
    capturedMessages: ModelMessage[][] = [];

    protected async executeGenerateText(messages: ModelMessage[]): Promise<any> {
        // Deep copy messages to avoid reference issues
        this.capturedMessages.push(JSON.parse(JSON.stringify(messages)));
        return {
            text: "Mocked response",
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 10 },
            content: [{ type: "text", text: "Mocked response" }]
        };
    }

    protected async registerBuiltinTools() {
        return;
    }
}

describe("CoreAgent History Pruning", () => {
    beforeEach(() => {
        resetConfig();
        setConfig({
            env: "development",
            providers: { ollama: { baseURL: "http://localhost:11434/v1", apiKey: "ollama" } },
            agents: {
                router: { provider: "ollama", model: "mock", mcpTools: [] },
                worker: { provider: "ollama", model: "mock", mcpTools: [] },
                gatekeeper: { provider: "ollama", model: "mock", mcpTools: [] }
            },
            worker: {
                timeout: 300,
                maxRetries: 3,
                min_workers: 1,
                max_workers: 5,
                load_factor: 1.0
            },
            pearls: {
                path: ".pearls",
                binary: "prl",
                autoSync: true
            },
            context: {
                maxHistoryMessages: 5,
                maxToolResponseSize: 50000,
                maxMessageSize: 100000
            }
        } as any);
    });

    it("should preserve the initial user request when pruning history", async () => {
        const agent = new TestAgent("worker");
        const initialPrompt = "Initial Request";

        // We need to run the agent loop multiple times to trigger pruning.
        // The loop in run() goes up to 50 iterations.
        // We need to mock tools to simulate multiple turns.

        // Actually, I can just mock executeGenerateText to return a tool call 
        // until we reach the threshold.

        let callCount = 0;
        (agent as any).executeGenerateText = async (messages: ModelMessage[]) => {
            agent.capturedMessages.push(JSON.parse(JSON.stringify(messages)));
            callCount++;

            if (callCount < 10) {
                return {
                    text: "",
                    finishReason: "tool-calls",
                    toolCalls: [{ toolCallId: "tc-" + callCount, toolName: "mock_tool", args: {} }],
                    usage: { promptTokens: 10, completionTokens: 10 },
                    content: [{ type: "tool-call", toolCallId: "tc-" + callCount, toolName: "mock_tool", args: {} }]
                };
            }

            return {
                text: "Done",
                finishReason: "stop",
                usage: { promptTokens: 10, completionTokens: 10 },
                content: [{ type: "text", text: "Done" }]
            };
        };

        // Register a mock tool
        (agent as any).registerTool("mock_tool", "desc", {}, async () => ({ status: "ok" }));

        await agent.run(initialPrompt);

        // Check the last captured messages
        const finalMessages = agent.capturedMessages[agent.capturedMessages.length - 1];

        // messages[0] should be system
        expect(finalMessages[0].role).toBe("system");

        // messages[1] should be the initial request
        expect(finalMessages[1].role).toBe("user");
        expect(finalMessages[1].content).toContain(initialPrompt);
    });
});
