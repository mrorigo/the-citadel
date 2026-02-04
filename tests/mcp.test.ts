import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { getMCPService } from '../src/services/mcp';
import { setConfig } from '../src/config';
import { WorkerAgent } from '../src/agents/worker';

// Mock the SDK
mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        connect = mock(async () => { });
        listTools = mock(async () => ({
            tools: [
                { name: 'echo', description: 'Echoes back', inputSchema: { type: 'object' } },
                { name: 'secret', description: 'Hidden tool', inputSchema: { type: 'object' } }
            ]
        }));
        // biome-ignore lint/suspicious/noExplicitAny: mock
        callTool = mock(async ({ name, arguments: args }: any) => {
            if (name === 'echo') return { content: [{ type: 'text', text: `Echo: ${args.message}` }] };
            return { content: [{ type: 'text', text: 'Forbidden' }] };
        });
        setRequestHandler = mock(() => { });
        close = mock(async () => { });
    }
}));

mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: class {
    }
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class {
    }
}));

describe('MCP Tools Integration', () => {
    beforeEach(async () => {
        const mcp = getMCPService();
        await mcp.shutdown(); // Ensure clean state
    });

    it('should discover tools from configured servers', async () => {
        setConfig({
            providers: {},
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            beads: { path: '.beads', binary: 'bd' },
            mcpServers: {
                testServer: { command: 'node', args: ['server.js'] }
            }
            // biome-ignore lint/suspicious/noExplicitAny: test config
        } as any);

        const mcp = getMCPService();
        await mcp.initialize();

        const agentTools = await mcp.getToolsForAgent(['testServer:*']);
        expect(agentTools.length).toBe(2);
        expect(agentTools[0]?.name).toBe('echo');
    });

    it('should discover tools from HTTP servers', async () => {
        setConfig({
            providers: {},
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            beads: { path: '.beads', binary: 'bd' },
            mcpServers: {
                httpServer: { url: 'https://mcp.example.com/api' }
            }
            // biome-ignore lint/suspicious/noExplicitAny: test config
        } as any);

        const mcp = getMCPService();
        await mcp.initialize();

        const agentTools = await mcp.getToolsForAgent(['httpServer:*']);
        expect(agentTools.length).toBe(2);
        expect(agentTools[1]?.name).toBe('secret');
    });

    it('should support granular tool assignment for agents', async () => {
        setConfig({
            providers: {},
            agents: {
                router: { provider: 'ollama', model: 'llama3', mcpTools: ['testServer:echo'] },
                worker: { provider: 'ollama', model: 'llama3' },
                supervisor: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            beads: { path: '.beads', binary: 'bd' },
            mcpServers: {
                testServer: { command: 'node', args: ['server.js'] }
            }
            // biome-ignore lint/suspicious/noExplicitAny: test config
        } as any);

        const mcp = getMCPService();
        await mcp.initialize();

        const agentTools = await mcp.getToolsForAgent(['testServer:echo']);
        expect(agentTools.length).toBe(1);
        expect(agentTools[0]?.name).toBe('echo');

        const secretTools = await mcp.getToolsForAgent(['testServer:secret']);
        expect(secretTools.length).toBe(1);
        expect(secretTools[0]?.name).toBe('secret');
    });

    it('should register MCP tools in WorkerAgent', async () => {
        // We need to mock getAgentModel for WorkerAgent
        // Using real model here as setConfig provides valid config

        setConfig({
            providers: {
                ollama: { baseURL: 'http://localhost', apiKey: 'test' }
            },
            agents: {
                router: { provider: 'ollama', model: 'llama3' },
                worker: { provider: 'ollama', model: 'llama3', mcpTools: ['testServer:echo'] },
                supervisor: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { timeout: 300, maxRetries: 3, costLimit: 1.0 },
            beads: { path: '.beads', binary: 'bd' },
            mcpServers: {
                testServer: { command: 'node', args: ['server.js'] }
            }
            // biome-ignore lint/suspicious/noExplicitAny: test config
        } as any);

        const mcp = getMCPService();
        await mcp.initialize();

        const agent = new WorkerAgent();
        // Trigger MCP tool loading (private method normally called in run)
        // biome-ignore lint/suspicious/noExplicitAny: access private for test
        await (agent as any).registerBuiltinTools();

        // biome-ignore lint/suspicious/noExplicitAny: access private for test
        const echoTool = (agent as any).tools.testServer_echo;
        expect(echoTool).toBeDefined();
        expect(echoTool.parameters).toBeDefined();
        expect(echoTool.parameters.jsonSchema).toEqual({ type: 'object' });

        // Test execution bridge
        const result = await echoTool.execute({ message: 'hello' });
        expect(result.content[0].text).toBe('Echo: hello');
    });
});
