import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolve } from 'node:path';
import { getConfig } from '../config';
import type { CitadelConfig } from '../config/schema';
import { getGlobalSingleton, setGlobalSingleton } from './registry';
import { logger } from './logger';

const execAsync = promisify(exec);

// --- Types ---

export const BeadStatusSchema = z.enum(['open', 'in_progress', 'verify', 'done']);
export type BeadStatus = z.infer<typeof BeadStatusSchema>;

export const BeadPrioritySchema = z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3),
    z.literal('0'), z.literal('1'), z.literal('2'), z.literal('3')
]).transform(val => typeof val === 'string' ? parseInt(val, 10) as 0 | 1 | 2 | 3 : val as 0 | 1 | 2 | 3);

export type BeadPriority = z.infer<typeof BeadPrioritySchema>;

// Raw schema matching 'bd' CLI output
const RawBeadSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(), // Raw status from CLI, e.g., 'closed'
    priority: BeadPrioritySchema,
    assignee: z.string().optional(),
    labels: z.array(z.string()).optional(),
    parent: z.string().optional(),
    dependencies: z.array(z.any()).optional(),
    blockers: z.array(z.string()).optional(),
    issue_type: z.string().optional(), // Added type field, maps to type in domain
    acceptance_criteria: z.string().optional(), // Maps to acceptance_test in domain
    description: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
});

type RawBead = z.infer<typeof RawBeadSchema>;

// Domain schema
export const BeadSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: BeadStatusSchema, // Mapped to our domain status
    priority: BeadPrioritySchema,
    assignee: z.string().optional(),
    labels: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    acceptance_test: z.string().optional(),
    parent: z.string().optional(),
    type: z.string().optional(), // Added type field
    description: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string(),
    updated_at: z.string(),
});

export type Bead = z.infer<typeof BeadSchema>;

export interface CreateOptions {
    priority?: 0 | 1 | 2 | 3;
    assignee?: string;
    blockers?: string[];
    acceptance_test?: string;
    description?: string;
    parent?: string; // Parent ID for molecules
    type?: string; // bead type (epic, story, task, convoy, etc)
    context?: Record<string, unknown>;
    labels?: string[];
}

// --- Client ---

export class BeadsClient {
    private basePath: string;
    private binary: string;

    constructor(basePath?: string, binary?: string) {
        let config: CitadelConfig | null = null;
        try {
            config = getConfig();
        } catch {
            // Config might not be loaded during init
        }
        this.basePath = basePath || config?.beads.path || '.beads';
        this.binary = binary || config?.beads.binary || 'bd';
    }

    protected async runCommand(args: string, retryCount = 0): Promise<string> {
        // Use --sandbox mode to avoid daemon issues in Docker containers
        // Sandbox mode operates in "direct mode" without requiring a daemon
        const command = `${this.binary} --sandbox ${args}`;

        // Determine CWD: The folder containing .beads folder, or the basePath itself if it is the root
        const cwd = this.basePath.endsWith('.beads') ? resolve(this.basePath, '..') : this.basePath;

        try {
            const { stdout, stderr } = await this.execute(command, cwd);
            if (stderr && !stdout) {
                // Some tools print info to stderr?
                // Assuming strictly JSON output on stdout for --json commands
            }
            return stdout.trim();
        } catch (error: unknown) {
            const err = error as Error;

            // Staleness detection and recovery
            const isStale = err.message.includes('Database out of sync with JSONL') ||
                err.message.includes('bd sync');

            if (isStale && retryCount === 0) {
                let autoSync = true;
                try {
                    const config = getConfig();
                    autoSync = config.beads.autoSync !== false;
                } catch { /* ignore if config fails */ }

                if (autoSync) {
                    logger.warn(`[Beads] Staleness detected. Triggering auto-sync and retry.`);
                    await this.sync(); // Default to import-only for speed/safety
                    return this.runCommand(args, retryCount + 1);
                }
            }

            throw new Error(`Beads command failed: ${command}\n${err.message}`);
        }
    }

    async init(): Promise<void> {
        await this.runCommand('init');
    }

    protected async execute(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
        return execAsync(command, { cwd });
    }

    async sync(): Promise<void> {
        await this.runCommand(`sync`);
        logger.info(`[Beads] Database synchronized`);
    }

    async doctor(): Promise<boolean> {
        try {
            // bd doctor returns JSON with overall_ok status
            const output = await this.runCommand('doctor --json');
            const result = JSON.parse(output);
            return result.overall_ok === true;
        } catch (_error) {
            // If bd doctor fails completely, it's not healthy
            return false;
        }
    }

    private parseRaw(output: string): Bead {
        if (!output) throw new Error('Empty output from bd');
        const json = JSON.parse(output);
        const raw = RawBeadSchema.parse(Array.isArray(json) ? json[0] : json);
        return this.mapToDomain(raw);
    }
    private parseRawList(output: string): Bead[] {
        if (!output) return [];
        try {
            const json = JSON.parse(output);
            if (Array.isArray(json)) {
                return json.map(item => {
                    try {
                        return this.mapToDomain(RawBeadSchema.parse(item));
                    } catch (e) {
                        console.warn(`[Beads] Failed to parse bead item:`, e, item);
                        return null;
                    }
                }).filter(b => !!b) as Bead[];
            }
        } catch (_e) {
            // Fallback to line delimited
        }

        return output.split('\n')
            .filter(line => line.trim())
            .flatMap(line => {
                try {
                    const parsed = JSON.parse(line);
                    // Handle if line is a full array (CLI sometimes does this)
                    if (Array.isArray(parsed)) {
                        return parsed.map(item => {
                            try {
                                return this.mapToDomain(RawBeadSchema.parse(item));
                            } catch (_e) { return null; }
                        });
                    }
                    return this.mapToDomain(RawBeadSchema.parse(parsed));
                } catch (_e) { return null; }
            })
            .filter(b => !!b) as Bead[];
    }

    private mapToDomain(raw: RawBead): Bead {
        let status: BeadStatus = 'open';

        if (raw.status === 'closed') {
            status = 'done';
        } else if (raw.status === 'in_progress') {
            if (raw.labels?.includes('verify')) {
                status = 'verify';
            } else {
                status = 'in_progress';
            }
        } else {
            status = 'open';
        }

        // Map dependencies to blockers
        let blockers: string[] = [];
        if (raw.dependencies) {
            blockers = raw.dependencies
                .filter(d => d.dependency_type === 'blocks')
                .map(d => d.id);
        } else if (raw.blockers) {
            blockers = raw.blockers;
        }

        // Parse context from description
        let context: Record<string, unknown> | undefined;
        let description = raw.description || undefined;

        if (description) {
            const match = description.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (match?.[1] && match[2]) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed && typeof parsed === 'object') {
                        context = parsed;
                        description = match[2];
                    }
                } catch {
                    // Ignore parse error
                }
            }
        }

        return {
            ...raw,
            status,
            type: raw.issue_type,
            blockers,
            acceptance_test: raw.acceptance_criteria,
            description,
            context
        };
    }

    async list(status?: BeadStatus): Promise<Bead[]> {
        // List logic complicates things because we map domain status -> CLI status
        // For 'verify', we need 'in_progress' and verify label...
        // bd list --status doesn't support complex filters easily?
        // We'll list all (or broad category) and filter in memory for now.

        // Minimal mapping for CLI query
        let cliStatus = '';
        if (status === 'done') cliStatus = 'closed';
        else if (status === 'verify') cliStatus = 'in_progress';
        else if (status === 'in_progress') cliStatus = 'in_progress';
        else if (status === 'open') cliStatus = 'open';

        // If querying verify, we'll get in_progress and filter.
        const flag = cliStatus ? `--status ${cliStatus}` : '';

        const output = await this.runCommand(`list ${flag} --json`);
        const beads = this.parseRawList(output);

        if (status) {
            return beads.filter(b => b.status === status);
        }
        return beads;
    }

    async ready(): Promise<Bead[]> {
        const output = await this.runCommand('ready --json');
        return this.parseRawList(output);
    }

    async getAll(): Promise<Bead[]> {
        const output = await this.runCommand('list --json');
        return this.parseRawList(output);
    }

    async get(id: string): Promise<Bead> {
        const output = await this.runCommand(`show ${id} --json`);
        return this.parseRaw(output);
    }

    async create(title: string, options: CreateOptions = {}): Promise<Bead> {
        let args = `create "${title}" --json`;
        if (options.priority !== undefined) args += ` -p ${options.priority}`;
        if (options.parent) args += ` --parent ${options.parent}`;
        if (options.type) args += ` --type ${options.type}`;

        let description = options.description || '';
        if (options.context) {
            const frontmatter = JSON.stringify(options.context, null, 2);
            description = `---\n${frontmatter}\n---\n${description}`;
        }

        if (description) {
            // Escape double quotes for CLI
            const escaped = description.replace(/"/g, '\\"');
            args += ` --description "${escaped}"`;
        }

        // Note: bd CLI might not support setting everything at create time yet,

        const output = await this.runCommand(args);
        const bead = this.parseRaw(output);

        // Apply extra fields if needed via update for robustness
        const updates: Partial<Bead> = {};
        let hasUpdates = false;

        if (options.acceptance_test) {
            updates.acceptance_test = options.acceptance_test;
            hasUpdates = true;
        }

        if (options.labels && options.labels.length > 0) {
            updates.labels = options.labels;
            hasUpdates = true;
        }

        if (hasUpdates) {
            await this.update(bead.id, updates);
        }

        if (options.blockers?.length) {
            for (const blockerId of options.blockers) {
                // Dependency: bead depends on blocker (bead is child/blocked, blocker is parent/blocker)
                await this.addDependency(bead.id, blockerId);
            }
        }

        // Return fresh
        return this.get(bead.id);
    }

    async update(id: string, changes: Partial<Bead>): Promise<Bead> {
        // strict state machine enforcement
        if (changes.status) {
            const current = await this.get(id);
            this.validateTransition(current, changes.status);

            // Enforce acceptance test for 'done' (unless failed)
            const isFailed = (changes.labels?.includes('failed')) || (!changes.labels && current.labels?.includes('failed'));
            if (changes.status === 'done' && !isFailed && !current.acceptance_test && !changes.acceptance_test) {
                throw new Error(`Cannot transition ${id} to 'done': missing acceptance_test`);
            }
        }

        // Construct update args
        let args = `update ${id}`;

        if (changes.status) {
            if (changes.status === 'done') {
                args += ` --status closed`;
            } else if (changes.status === 'verify') {
                args += ` --status in_progress --add-label verify`;
            } else if (changes.status === 'in_progress') {
                args += ` --status in_progress --remove-label verify`;
            } else if (changes.status === 'open') {
                args += ` --status open --remove-label verify`;
            }
        }

        if (changes.acceptance_test) {
            args += ` --acceptance "${changes.acceptance_test}"`;
        }

        if (changes.labels) {
            // Append labels using --add-label
            for (const label of changes.labels) {
                args += ` --add-label "${label}"`;
            }
        }

        // @ts-expect-error - Extension for internal use
        if (changes.remove_labels) {
            // Remove labels using --remove-label
            // @ts-expect-error
            for (const label of changes.remove_labels) {
                args += ` --remove-label "${label}"`;
            }
        }

        if (changes.context) {
            // Context is stored in description frontmatter.
            // We need to preserve the text body of description.
            // If we didn't fetch 'current' yet, we must.
            // (changes.status logic fetches it, but scoped)
            const current = await this.get(id);
            let descText = current.description || '';

            // Strip existing frontmatter
            const match = descText.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
            if (match?.[1]) {
                descText = match[1];
            }

            const frontmatter = JSON.stringify(changes.context, null, 2);
            const newDesc = `---\n${frontmatter}\n---\n${descText}`;

            const escaped = newDesc.replace(/"/g, '\\"');
            args += ` --description "${escaped}"`;
        }

        // ... other fields
        args += ` --json`;

        const output = await this.runCommand(args);
        if (!output) {
            // Fallback: fetch updated bead if update command had no output
            return this.get(id);
        }
        return this.parseRaw(output);
    }

    private validateTransition(current: Bead, next: BeadStatus) {
        const validTransitions: Record<BeadStatus, BeadStatus[]> = {
            'open': ['in_progress', 'done'], // Allow skipping (open->done)
            'in_progress': ['verify', 'open'], // Allow moving back to open if dropped
            'verify': ['done', 'in_progress', 'open'], // FIX: Allow rejecting back to open
            'done': ['in_progress', 'open'] // Reopen cases
        };

        if (current.status === next) return;

        const allowed = validTransitions[current.status];
        if (!allowed.includes(next)) {
            throw new Error(`Invalid state transition for ${current.id}: ${current.status} -> ${next}`);
        }
    }

    async addDependency(childId: string, parentId: string): Promise<void> {
        // bd dep add <child> <parent>
        await this.runCommand(`dep add ${childId} ${parentId}`);
    }
}

// Singleton accessor
const BEADS_KEY = 'beads_client';
export function getBeads(basePath?: string): BeadsClient {
    return getGlobalSingleton(BEADS_KEY, () => {
        let path = basePath;
        if (!path) {
            try {
                const config = getConfig();
                path = config.beads.path;
            } catch {
                path = '.beads';
            }
        }
        return new BeadsClient(path);
    });
}

export function setBeadsInstance(beads: BeadsClient) {
    setGlobalSingleton(BEADS_KEY, beads);
}
