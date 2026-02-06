import { getConfig } from "../config";
import { getBeads } from "./beads";
import { getFormulaRegistry } from "./formula";
import type { InstructionContext, InstructionProvider } from "./instruction";
import { logger } from "./logger";
import { getMCPService } from "../services/mcp";

export class MCPResourceProvider implements InstructionProvider {
    name = "mcp-resources";
    priority = 25; // Between Role (20) and Formula (30)

    async getInstructions(ctx: InstructionContext): Promise<string | null> {
        const resourcesToFetch: Record<string, Set<string>> = {};

        // 1. Config-level resources
        const config = getConfig();
        const roleConfig = config.agents[ctx.role];
        if (roleConfig && "mcpResources" in roleConfig && roleConfig.mcpResources) {
            this.mergeResources(resourcesToFetch, roleConfig.mcpResources as Record<string, string[]>);
        }

        // 2. Formula-level resources
        if (ctx.beadId) {
            try {
                const bead = await getBeads().get(ctx.beadId);
                const formulaLabel = bead.labels?.find((l) => l.startsWith("formula:"));
                if (formulaLabel) {
                    const formulaName = formulaLabel.split(":")[1];
                    if (formulaName) {
                        const formula = getFormulaRegistry().get(formulaName);
                        if (formula?.mcp_resources) {
                            this.mergeResources(resourcesToFetch, formula.mcp_resources);
                        }
                    }
                }

                // 3. Dynamic Context Override
                if (bead.context?.mcp_resources) {
                    this.mergeResources(resourcesToFetch, bead.context.mcp_resources as Record<string, string[]>);
                }
            } catch (err) {
                logger.debug(`[MCPResourceProvider] Error fetching resources from bead/formula: ${err}`);
            }
        }

        if (Object.keys(resourcesToFetch).length === 0) return null;

        const mcpService = getMCPService();
        const results: string[] = [];

        for (const [serverName, uris] of Object.entries(resourcesToFetch)) {
            for (const uri of uris) {
                try {
                    const contents = await mcpService.readResource(serverName, uri);
                    if (contents.length > 0) {
                        results.push(`## RESOURCE: ${serverName}:${uri}\n${contents.join("\n\n")}`);
                    }
                } catch (err) {
                    logger.warn(`[MCPResourceProvider] Failed to fetch resource ${serverName}:${uri}: ${err}`);
                }
            }
        }

        if (results.length === 0) return null;

        return `
# CONTEXT RESOURCES
The following resources have been injected into your context for this task:

${results.join("\n\n--- \n\n")}
`;
    }

    private mergeResources(target: Record<string, Set<string>>, source: Record<string, string[]>) {
        for (const [server, uris] of Object.entries(source)) {
            if (!target[server]) {
                target[server] = new Set();
            }
            for (const uri of uris) {
                target[server].add(uri);
            }
        }
    }
}
