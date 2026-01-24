import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

export interface AgentsMdConfig {
    raw: string;
    sections: Record<string, string>;
    commands: {
        setup: string[];
        test: string[];
        lint: string[];
        build: string[];
        other: string[];
    };
    rules: string[];
}

export type AgentsMdContext = {
    sourcePath: string;
    config: AgentsMdConfig;
} | null;

export class ProjectContextService {
    private cache: Map<string, AgentsMdContext> = new Map();

    /**
     * Resolve the most relevant AGENTS.md context for a given target path.
     * Follows the "closest-file-wins" rule, bubbling up to the repo root.
     */
    async resolveContext(targetPath: string, rootDir: string): Promise<AgentsMdContext> {
        let currentDir = resolve(targetPath);
        // If target is file, start at dirname
        // (Is file check: simple heuristic, if it has extension or we can check stat, 
        // but robustly we assume usually we are given a dir or we climb out of file)
        // Simplest: just assume it might be a file, if so dirname it? 
        // Or just walk up. `dirname` of a dir is its parent.

        const rootPath = resolve(rootDir);

        // Safety break
        let steps = 0;
        const maxSteps = 20;

        while (currentDir.startsWith(rootPath) && steps < maxSteps) {
            steps++;
            const agentsMdPath = join(currentDir, 'AGENTS.md');

            if (this.cache.has(agentsMdPath)) {
                return this.cache.get(agentsMdPath) || null;
            }

            if (existsSync(agentsMdPath)) {
                try {
                    const content = await readFile(agentsMdPath, 'utf-8');
                    const config = this.parseAgentsMd(content);
                    const context = { sourcePath: agentsMdPath, config };
                    this.cache.set(agentsMdPath, context);
                    return context;
                } catch (e) {
                    console.error(`[ProjectContext] Failed to read ${agentsMdPath}`, e);
                }
            }

            if (currentDir === rootPath) break;
            currentDir = dirname(currentDir);
        }

        return null; // No AGENTS.md found
    }

    /**
     * Parse AGENTS.md content into a structured config.
     */
    parseAgentsMd(content: string): AgentsMdConfig {
        const sections: Record<string, string> = {};
        const commands = {
            setup: [] as string[],
            test: [] as string[],
            lint: [] as string[],
            build: [] as string[],
            other: [] as string[]
        };
        const rules: string[] = [];

        // Simple heuristic parsing
        const lines = content.split('\n');
        let currentSection = 'intro';

        for (const line of lines) {
            // Heading detection
            if (line.startsWith('#')) {
                currentSection = line.replace(/^#+\s*/, '').toLowerCase().trim();
                continue;
            }

            // Append to generic section text
            if (!sections[currentSection]) sections[currentSection] = '';
            sections[currentSection] += line + '\n';

            // Command extraction (heuristic: code blocks or indented lines often contain commands)
            // Ideally we look for fenced code blocks, but line-by-line is harder.
            // Let's rely on regex for finding commands in the whole block later or simplistic keyword matching?
            // "Run `npm test`" -> extract `npm test`
        }

        // Simpler approach: Regex extraction over full content
        // Look for backticked commands starting with common package managers
        const commandRegex = /`(?:npm|pnpm|yarn|bun|make|cargo|gradle|\.\/)([^`]+)`/g;
        let match: RegExpExecArray | null;

        while ((match = commandRegex.exec(content)) !== null) {
            const cmd = match[0].replace(/`/g, '');
            if (cmd.includes('test')) commands.test.push(cmd);
            else if (cmd.includes('lint')) commands.lint.push(cmd);
            else if (cmd.includes('build')) commands.build.push(cmd);
            else if (cmd.includes('install') || cmd.includes('setup')) commands.setup.push(cmd);
            else commands.other.push(cmd);
        }

        // Rule extraction (imperative keywords)
        const ruleRegex = /(?:Always|Never|Must|Ensure|Verify|Done =)\s+([^.\n]+)/gi;
        while ((match = ruleRegex.exec(content)) !== null) {
            rules.push(match[0].trim());
        }

        return {
            raw: content,
            sections,
            commands,
            rules
        };
    }
}

let _instance: ProjectContextService | null = null;

export function getProjectContext(): ProjectContextService {
    if (!_instance) {
        _instance = new ProjectContextService();
    }
    return _instance;
}
