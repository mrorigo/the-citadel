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
     * Follows the "closest-file-wins" rule but falls back to root-level AGENTS.md for global policies.
     */
    async resolveContext(targetPath: string, rootDir: string): Promise<AgentsMdContext> {
        let currentDir = resolve(targetPath);
        const rootPath = resolve(rootDir);

        // 1. Find the closest AGENTS.md
        let closestConfig: AgentsMdConfig | null = null;
        let closestPath: string | null = null;

        const maxSteps = 20;
        let steps = 0;

        while (currentDir.startsWith(rootPath) && steps < maxSteps) {
            steps++;
            const candidatePath = join(currentDir, 'AGENTS.md');

            if (this.cache.has(candidatePath)) {
                const cached = this.cache.get(candidatePath);
                if (cached) {
                    closestConfig = cached.config;
                    closestPath = cached.sourcePath;
                    break;
                }
            } else if (existsSync(candidatePath)) {
                try {
                    const content = await readFile(candidatePath, 'utf-8');
                    closestConfig = this.parseAgentsMd(content);
                    closestPath = candidatePath;
                    // Cache indiv file
                    this.cache.set(candidatePath, { sourcePath: candidatePath, config: closestConfig });
                    break;
                } catch (e) {
                    console.error(`[ProjectContext] Failed to read ${candidatePath}`, e);
                }
            }

            if (currentDir === rootPath) break;
            currentDir = dirname(currentDir);
        }

        // 2. If we found nothing, return null
        if (!closestConfig || !closestPath) {
            return null;
        }

        // 3. If the closest is the root, return it
        if (dirname(closestPath) === rootPath) {
            return { sourcePath: closestPath, config: closestConfig };
        }

        // 4. Otherwise, check for root AGENTS.md to merge as fallback
        const rootAgentPath = join(rootPath, 'AGENTS.md');
        let rootConfig: AgentsMdConfig | null = null;

        if (this.cache.has(rootAgentPath)) {
            rootConfig = this.cache.get(rootAgentPath)!.config;
        } else if (existsSync(rootAgentPath)) {
            try {
                const content = await readFile(rootAgentPath, 'utf-8');
                rootConfig = this.parseAgentsMd(content);
                this.cache.set(rootAgentPath, { sourcePath: rootAgentPath, config: rootConfig });
            } catch (e) {
                console.error(`[ProjectContext] Failed to read root ${rootAgentPath}`, e);
            }
        }

        if (rootConfig) {
            return {
                sourcePath: closestPath, // Primary source is still the closest one
                config: this.mergeConfigs(closestConfig, rootConfig)
            };
        }

        return { sourcePath: closestPath, config: closestConfig };
    }

    private mergeConfigs(child: AgentsMdConfig, parent: AgentsMdConfig): AgentsMdConfig {
        return {
            raw: child.raw + '\n\n' + parent.raw, // Keep full context
            sections: { ...parent.sections, ...child.sections }, // Child overrides parent sections
            commands: {
                setup: [...child.commands.setup, ...parent.commands.setup],
                test: [...child.commands.test, ...parent.commands.test],
                lint: [...child.commands.lint, ...parent.commands.lint],
                build: [...child.commands.build, ...parent.commands.build],
                other: [...child.commands.other, ...parent.commands.other],
            },
            rules: [...child.rules, ...parent.rules] // Accumulate rules
        };
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

        // Regex extraction over full content
        // 1. Backticked commands
        const commandRegex = /`(?:npm|pnpm|yarn|bun|make|cargo|gradle|\.\/)([^`]+)`/g;
        let match: RegExpExecArray | null;

        const processCommand = (cmd: string) => {
            cmd = cmd.trim();
            if (!cmd) return;
            if (cmd.includes('test')) commands.test.push(cmd);
            else if (cmd.includes('lint')) commands.lint.push(cmd);
            else if (cmd.includes('build')) commands.build.push(cmd);
            else if (cmd.includes('install') || cmd.includes('setup')) commands.setup.push(cmd);
            else commands.other.push(cmd);
        };

        while ((match = commandRegex.exec(content)) !== null) {
            processCommand(match[0].replace(/`/g, ''));
        }

        // 2. Fenced code blocks (bash/sh/zsh/shell)
        const codeBlockRegex = /```(?:bash|sh|zsh|shell|cmd|powershell)\s*([\s\S]*?)```/g;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            const blockContent = match[1] || '';
            const lines = blockContent.split('\n');
            for (const line of lines) {
                // Heuristic: ignore comments and empty lines, take anything that looks like a command start
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    processCommand(trimmed);
                }
            }
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
