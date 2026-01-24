import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolve } from 'path';
import { getConfig } from '../config';

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
    labels: z.array(z.string()).optional(), // New field from CLI
    blockers: z.array(z.string()).optional(),
    acceptance_test: z.string().optional(),
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
    created_at: z.string(),
    updated_at: z.string(),
});

export type Bead = z.infer<typeof BeadSchema>;

export interface CreateOptions {
    priority?: 0 | 1 | 2 | 3;
    assignee?: string;
    blockers?: string[];
    acceptance_test?: string;
}

// --- Client ---

export class BeadsClient {
    private basePath: string;

    constructor(basePath?: string) {
        this.basePath = basePath || getConfig().beads.path;
    }

    private async runCommand(args: string): Promise<string> {
        // Use system bd binary
        const command = `bd ${args}`;

        // Determine CWD: The parent of .beads folder
        const cwd = resolve(this.basePath, '..');

        try {
            const { stdout, stderr } = await execAsync(command, { cwd });
            if (stderr && !stdout) {
                // Some tools print info to stderr?
                // Assuming strict JSON output on stdout for --json commands
            }
            return stdout.trim();
        } catch (error: any) {
            throw new Error(`Beads command failed: ${command}\n${error.message}`);
        }
    }

    async init(): Promise<void> {
        await this.runCommand('init');
    }

    private parseRaw(output: string): Bead {
        if (!output) throw new Error('Empty output from bd');
        const json = JSON.parse(output);
        const raw = RawBeadSchema.parse(Array.isArray(json) ? json[0] : json);
        return this.mapToDomain(raw);
    }

    private parseRawList(output: string): Bead[] {
        if (!output) return [];
        // Handle line-delimited JSON or array of objects
        // bd list --json often returns line-delimited
        // bd show --json returns array
        try {
            const json = JSON.parse(output);
            if (Array.isArray(json)) {
                return json.map(item => this.mapToDomain(RawBeadSchema.parse(item)));
            }
        } catch (e) {
            // Fallback to line delimited
        }

        return output.split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return this.mapToDomain(RawBeadSchema.parse(JSON.parse(line)));
                } catch (e) { return null as any; } // Filter out invalid lines
            })
            .filter(b => !!b);
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
            status = 'open'; // Default fallback, or map correctly if other statuses exist
        }

        return {
            ...raw,
            status
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

    async get(id: string): Promise<Bead> {
        const output = await this.runCommand(`show ${id} --json`);
        return this.parseRaw(output);
    }

    async create(title: string, options: CreateOptions = {}): Promise<Bead> {
        let args = `create "${title}" --json`;
        if (options.priority !== undefined) args += ` -p ${options.priority}`;

        // Note: bd CLI might not support setting everything at create time yet,
        // so we might need to update immediately after.
        // Checking README: bd create "Title" -p 0

        const output = await this.runCommand(args);
        const bead = this.parseRaw(output);

        // Apply extra fields if needed
        if (options.acceptance_test || options.blockers?.length) {
            // TODO: distinct update call if create doesn't support these flags
            // For now assuming we might need to implement update
        }

        return bead;
    }

    async update(id: string, changes: Partial<Bead>): Promise<Bead> {
        // strict state machine enforcement
        if (changes.status) {
            const current = await this.get(id);
            this.validateTransition(current, changes.status);

            // Enforce acceptance test for 'done'
            if (changes.status === 'done' && !current.acceptance_test && !changes.acceptance_test) {
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
            'open': ['in_progress'],
            'in_progress': ['verify', 'open'], // Allow moving back to open if dropped
            'verify': ['done', 'in_progress'], // Verify -> Done or back to In Progress if failed
            'done': ['in_progress', 'open'] // Reopen cases
        };

        if (current.status === next) return;

        const allowed = validTransitions[current.status];
        if (!allowed.includes(next)) {
            throw new Error(`Invalid state transition for ${current.id}: ${current.status} -> ${next}`);
        }
    }
}

// Singleton accessor
// Singleton accessor
let _beads: BeadsClient | null = null;
export function getBeads(basePath?: string): BeadsClient {
    if (!_beads) {
        const config = getConfig();
        const path = basePath || config.beads.path;
        _beads = new BeadsClient(path);
    }
    return _beads;
}

export function setBeadsInstance(beads: BeadsClient) {
    _beads = beads;
}

