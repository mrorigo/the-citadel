import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ListRootsRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "../config";
import { logger } from "../core/logger";

export interface MCPTool {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export class MCPService {
	private static instance: MCPService;
	private clients: Map<string, Client> = new Map();
	private tools: Map<string, MCPTool[]> = new Map(); // serverName -> tools

	private constructor() { }

	static getInstance(): MCPService {
		if (!MCPService.instance) {
			MCPService.instance = new MCPService();
		}
		return MCPService.instance;
	}

	async initialize(): Promise<void> {
		const config = getConfig();
		if (!config.mcpServers) return;

		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			try {
				logger.info(`[MCP] Connecting to server: ${name}...`);
				let transport: Transport;

				const url = serverConfig.url;
				const command = serverConfig.command;

				if (url) {
					logger.info(`[MCP] Using HTTP transport for ${name}: ${url}`);
					transport = new StreamableHTTPClientTransport(new URL(url), {
						requestInit: {
							headers: serverConfig.headers,
						},
					});
				} else if (command) {
					logger.info(`[MCP] Using Stdio transport for ${name}`);
					transport = new StdioClientTransport({
						command: command,
						args: serverConfig.args,
						env: { ...process.env, ...serverConfig.env } as Record<
							string,
							string
						>,
					});
				} else {
					throw new Error(`Server ${name} has neither url nor command`);
				}

				const client = new Client(
					{ name: "the-citadel", version: "1.0.0" },
					{ capabilities: { roots: { listChanged: true } } },
				);

				// Set up roots handler
				client.setRequestHandler(ListRootsRequestSchema, async () => {
					return {
						roots: [
							{
								uri: `file://${process.cwd()}`,
								name: "Current Project Workspace",
							},
						],
					};
				});

				await client.connect(transport);
				this.clients.set(name, client);

				// Discover tools
				const toolsResult = await client.listTools();
				this.tools.set(
					name,
					toolsResult.tools.map((t) => ({
						serverName: name,
						...t,
					})),
				);

				logger.info(
					`[MCP] Connected to ${name}, discovered ${toolsResult.tools.length} tools`,
				);
			} catch (error) {
				logger.error(`[MCP] Failed to connect to server ${name}:`, error);
			}
		}
	}

	async getToolsForAgent(assignedTools?: string[]): Promise<MCPTool[]> {
		if (!assignedTools || assignedTools.length === 0) return [];

		const result: MCPTool[] = [];
		for (const pattern of assignedTools) {
			const [serverName, toolName] = pattern.split(":");
			if (!serverName || !toolName) continue;

			const serverTools = this.tools.get(serverName);
			if (!serverTools) continue;

			if (toolName === "*") {
				result.push(...serverTools);
			} else {
				const tool = serverTools.find((t) => t.name === toolName);
				if (tool) result.push(tool);
			}
		}
		return result;
	}

	async callTool(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`MCP server ${serverName} not connected`);
		}

		logger.info(`[MCP] Calling tool ${serverName}:${toolName}`, { args });
		return await client.callTool({
			name: toolName,
			arguments: args,
		});
	}

	async readResource(serverName: string, uri: string): Promise<string[]> {
		const client = this.clients.get(serverName);
		if (!client) {
			logger.warn(`[MCP] Server ${serverName} not connected for resource ${uri}`);
			return [];
		}

		try {
			logger.info(`[MCP] Reading resource ${serverName}:${uri}`);
			const result = (await client.request(
				{
					method: "resources/read",
					params: { uri },
				},
				ReadResourceRequestSchema,
			)) as any;

			return (result.contents as any[])
				.map((content: any) => {
					if ("text" in content && content.text) {
						return content.text as string;
					}
					if ("blob" in content) {
						logger.warn(`[MCP] Skipping binary resource content for ${uri}`);
					}
					return null;
				})
				.filter((text: string | null): text is string => text !== null);
		} catch (error) {
			logger.error(`[MCP] Failed to read resource ${serverName}:${uri}:`, error);
			return [];
		}
	}

	async listResources(serverName: string): Promise<unknown[]> {
		const client = this.clients.get(serverName);
		if (!client) {
			logger.warn(`[MCP] Server ${serverName} not connected for listResources`);
			return [];
		}

		try {
			const result = (await client.request(
				{
					method: "resources/list",
				},
				ListResourcesRequestSchema,
			)) as any;
			return result.resources as unknown[];
		} catch (error) {
			logger.error(`[MCP] Failed to list resources for ${serverName}:`, error);
			return [];
		}
	}

	async shutdown(): Promise<void> {
		for (const [name, client] of this.clients) {
			try {
				await client.close();
				logger.info(`[MCP] Disconnected from ${name}`);
			} catch (error) {
				logger.error(`[MCP] Error disconnecting from ${name}:`, error);
			}
		}
		this.clients.clear();
		this.tools.clear();
	}
}

export function getMCPService(): MCPService {
	return MCPService.getInstance();
}
