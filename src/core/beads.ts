import { exec } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getConfig } from "../config";
import type { CitadelConfig } from "../config/schema";
import { logger } from "./logger";
import { getGlobalSingleton, setGlobalSingleton } from "./registry";

const execAsync = promisify(exec);

// --- Types ---

export const BeadStatusSchema = z.enum([
    "open",
    "in_progress",
    "verify",
    "done",
]);
export type BeadStatus = z.infer<typeof BeadStatusSchema>;

export const BeadPrioritySchema = z.any().transform((val) => {
    if (typeof val === "number") return val as 0 | 1 | 2 | 3 | 4;
    if (typeof val === "string") {
        const s = val.replace(/^P/, "");
        const n = parseInt(s, 10);
        if (!isNaN(n)) return n as 0 | 1 | 2 | 3 | 4;
    }
    return 2 as 0 | 1 | 2 | 3 | 4; // Default to P2
});

export type BeadPriority = z.infer<typeof BeadPrioritySchema>;

// Raw schema matching 'prl' CLI output
const RawBeadSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(), // Raw status from CLI, e.g., 'InProgress'
    priority: BeadPrioritySchema,
    author: z.string().optional(),
    labels: z.array(z.string()).optional(),
    links: z.array(z.object({
        target_id: z.string(),
        link_type: z.string(),
    })).optional(),
    deps: z.array(z.object({
        target_id: z.string(),
        dep_type: z.string(),
    }).or(z.string())).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    description: z.string().optional(),
    created_at: z.any(),
    updated_at: z.any(),
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
    priority?: 0 | 1 | 2 | 3 | 4;
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
        this.basePath = basePath || config?.beads?.path || ".pearls";
        this.binary = binary || config?.beads?.binary || "prl";
    }

    protected async runCommand(args: string): Promise<string> {
        const command = `${this.binary} ${args}`;

        // Determine CWD: The folder containing .pearls folder, or the basePath itself if it is the root
        const cwd = this.basePath.endsWith(".pearls")
            ? resolve(this.basePath, "..")
            : this.basePath;

        try {
            const { stdout, stderr } = await this.execute(command, cwd);
            if (stderr && !stdout && !stderr.includes("warning")) {
                // Some tools print info to stderr?
            }
            return stdout.trim();
        } catch (error: unknown) {
            const err = error as Error;
            throw new Error(`Pearls command failed: ${command}\n${err.message}`);
        }
    }

    async init(): Promise<void> {
        await this.runCommand("init");
    }

    protected async execute(
        command: string,
        cwd: string,
    ): Promise<{ stdout: string; stderr: string }> {
        return execAsync(command, { cwd });
    }

    async sync(): Promise<void> {
        await this.runCommand(`sync`);
        logger.info(`[Pearls] Database synchronized`);
    }

    async doctor(): Promise<boolean> {
        try {
            const output = await this.runCommand("doctor --format json");
            return !output.toLowerCase().includes("error");
        } catch (_error) {
            return false;
        }
    }

    private parseRaw(output: string): Bead {
        if (!output) throw new Error("Empty output from prl");
        let json: any;
        try {
            json = JSON.parse(output);
        } catch (e) {
            // Find start of JSON
            const start = output.indexOf("{");
            if (start !== -1) {
                // Try to find the matching end brace
                let braceCount = 0;
                let end = -1;
                for (let i = start; i < output.length; i++) {
                    if (output[i] === "{") braceCount++;
                    else if (output[i] === "}") {
                        braceCount--;
                        if (braceCount === 0) {
                            end = i;
                            break;
                        }
                    }
                }

                if (end !== -1) {
                    try {
                        json = JSON.parse(output.substring(start, end + 1));
                    } catch {
                        throw new Error(`Failed to parse Pearls JSON (with extraction): ${output}`);
                    }
                } else {
                    throw new Error(`Failed to parse Pearls JSON (no end brace): ${output}`);
                }
            } else {
                throw new Error(`Failed to parse Pearls JSON: ${output}`);
            }
        }

        // Pearls returns a wrapper: { action: 'create', pearl: { ... }, status: 'ok' }
        // Or sometimes just the pearl object.
        const pearl = json.pearl || json.issue || (Array.isArray(json) ? json[0] : json);

        if (!pearl || typeof pearl !== "object") {
            // Handle if it's nested in 'pearls' array
            if (json.pearls && Array.isArray(json.pearls) && json.pearls.length > 0) {
                return this.mapToDomain(RawBeadSchema.parse(json.pearls[0]));
            }
            throw new Error(`Unexpected Pearls output format: ${output}`);
        }

        const raw = RawBeadSchema.parse(pearl);
        return this.mapToDomain(raw);
    }

    private parseRawList(output: string): Bead[] {
        if (!output) return [];
        let json: any;
        try {
            json = JSON.parse(output);
        } catch (e) {
            // Find start of JSON
            const start = output.indexOf("[") !== -1 ? output.indexOf("[") : output.indexOf("{");
            if (start !== -1) {
                // Use matching brace/bracket logic
                const opener = output[start];
                const closer = opener === "[" ? "]" : "}";
                let count = 0;
                let end = -1;
                for (let i = start; i < output.length; i++) {
                    if (output[i] === opener) count++;
                    else if (output[i] === closer) {
                        count--;
                        if (count === 0) {
                            end = i;
                            break;
                        }
                    }
                }

                if (end !== -1) {
                    try {
                        json = JSON.parse(output.substring(start, end + 1));
                    } catch {
                        return [];
                    }
                } else {
                    return [];
                }
            } else {
                return [];
            }
        }

        // Handle wrapper { pearls/ready/issues: [...], total: n }
        const list = json.pearls || json.ready || json.issues || (Array.isArray(json) ? json : [json]);

        if (Array.isArray(list)) {
            return list
                .map((item) => {
                    try {
                        return this.mapToDomain(RawBeadSchema.parse(item));
                    } catch (e) {
                        console.warn(`[Pearls] Failed to parse bead item:`, e, item);
                        return null;
                    }
                })
                .filter((b) => !!b) as Bead[];
        }
        return [];
    }

    private mapToDomain(raw: RawBead): Bead {
        let status: BeadStatus = "open";

        const rawStatus = raw.status.toLowerCase();
        if (rawStatus === "closed") {
            status = "done";
        } else if (rawStatus === "inprogress" || rawStatus === "in_progress") {
            if (raw.labels?.includes("verify")) {
                status = "verify";
            } else {
                status = "in_progress";
            }
        } else {
            status = "open";
        }

        // Map links to blockers/parent
        const blockers: string[] = [];
        let parent: string | undefined;

        // Pearls uses 'deps' as well as 'links'? Let's check from list output
        // List output has 'deps': []
        if (raw.links) {
            for (const link of raw.links) {
                if (link.link_type === "blocks") {
                    blockers.push(link.target_id);
                } else if (link.link_type === "parent_child") {
                    parent = link.target_id;
                }
            }
        }

        if (raw.deps && Array.isArray(raw.deps)) {
            for (const dep of raw.deps) {
                if (typeof dep === 'string') {
                    blockers.push(dep);
                } else {
                    if (dep.dep_type === "blocks") {
                        blockers.push(dep.target_id);
                    } else if (dep.dep_type === "parent_child") {
                        parent = dep.target_id;
                    }
                }
            }
        }

        // Pearls metadata
        let acceptance_test = raw.metadata?.acceptance_test as string | undefined;
        const type = (raw.metadata?.type || raw.metadata?.issue_type) as string | undefined;
        let context = raw.metadata?.context as Record<string, unknown> | undefined;

        // Fallback for context from description frontmatter (backward compat)
        let description = raw.description || undefined;
        if (description && !context) {
            const match = description.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (match?.[1] && match[2]) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed && typeof parsed === "object") {
                        context = parsed;
                        description = match[2];
                    }
                } catch { /* ignore */ }
            }
        }

        return {
            id: raw.id,
            title: raw.title,
            status,
            priority: raw.priority as any,
            assignee: raw.author,
            labels: raw.labels,
            blockers,
            acceptance_test,
            parent,
            type,
            description,
            context,
            created_at: typeof raw.created_at === "number" ? new Date(raw.created_at * 1000).toISOString() : raw.created_at,
            updated_at: typeof raw.updated_at === "number" ? new Date(raw.updated_at * 1000).toISOString() : raw.updated_at,
        };
    }

    async list(status?: BeadStatus): Promise<Bead[]> {
        let cliStatus = "";
        if (status === "done") cliStatus = "closed";
        else if (status === "verify") cliStatus = "in_progress";
        else if (status === "in_progress") cliStatus = "in_progress";
        else if (status === "open") cliStatus = "open";

        const flag = cliStatus ? `--status ${cliStatus}` : "";
        const output = await this.runCommand(`list ${flag} --format json`);
        const beads = this.parseRawList(output);

        if (status) {
            return beads.filter((b) => b.status === status);
        }
        return beads;
    }

    async ready(): Promise<Bead[]> {
        const output = await this.runCommand("ready --format json");
        return this.parseRawList(output);
    }

    async getAll(): Promise<Bead[]> {
        const output = await this.runCommand("list --format json");
        return this.parseRawList(output);
    }

    async get(id: string): Promise<Bead> {
        const output = await this.runCommand(`show ${id} --format json`);
        return this.parseRaw(output);
    }

    async create(title: string, options: CreateOptions = {}): Promise<Bead> {
        let args = `create "${title}"`;
        if (options.priority !== undefined) args += ` --priority ${options.priority}`;
        if (options.description) {
            const escaped = options.description.replace(/"/g, '\\"');
            args += ` --description "${escaped}"`;
        }
        args += " --format json";

        const output = await this.runCommand(args);
        const bead = this.parseRaw(output);

        // Update metadata and links
        const updates: any = {};
        if (options.acceptance_test) updates.acceptance_test = options.acceptance_test;
        if (options.type) updates.type = options.type;
        if (options.context) updates.context = options.context;

        for (const [key, val] of Object.entries(updates)) {
            const escaped = JSON.stringify(val).replace(/"/g, '\\"');
            await this.runCommand(`meta set ${bead.id} ${key} "${escaped}" --format json`);
        }

        if (options.labels?.length) {
            for (const label of options.labels) {
                await this.runCommand(`update ${bead.id} --add-label "${label}" --format json`);
            }
        }

        if (options.blockers?.length) {
            for (const blockerId of options.blockers) {
                await this.runCommand(`link ${bead.id} ${blockerId} blocks --format json`);
            }
        }

        if (options.parent) {
            await this.runCommand(`link ${bead.id} ${options.parent} parent_child --format json`);
        }

        return this.get(bead.id);
    }

    async update(id: string, changes: Partial<Bead>): Promise<Bead> {
        let current: Bead | undefined;

        if (changes.status) {
            current = await this.get(id);
            this.validateTransition(current, changes.status);

            const isFailed =
                changes.labels?.includes("failed") ||
                (!changes.labels && current.labels?.includes("failed"));
            if (
                changes.status === "done" &&
                !isFailed &&
                !current.acceptance_test &&
                !changes.acceptance_test
            ) {
                throw new Error(
                    `Cannot transition ${id} to 'done': missing acceptance_test`,
                );
            }
        }

        let args = `update ${id}`;

        if (changes.status) {
            if (!current) current = await this.get(id);

            // Domain status -> CLI status mapping
            let targetCliStatus = "";
            if (changes.status === "done") targetCliStatus = "closed";
            else if (changes.status === "verify") targetCliStatus = "in_progress";
            else if (changes.status === "in_progress") targetCliStatus = "in_progress";
            else if (changes.status === "open") targetCliStatus = "open";

            // Map current domain status back to raw CLI status for comparison
            let currentCliStatus = "";
            if (current.status === "done") currentCliStatus = "closed";
            else if (current.status === "verify") currentCliStatus = "in_progress";
            else if (current.status === "in_progress") currentCliStatus = "in_progress";
            else if (current.status === "open") currentCliStatus = "open";

            if (targetCliStatus && targetCliStatus !== currentCliStatus) {
                args += ` --status ${targetCliStatus}`;
            }

            // Handle labels for 'verify'
            if (changes.status === "verify") {
                args += ` --add-label verify`;
            } else if (changes.status === "in_progress") {
                args += ` --remove-label verify`;
            } else if (changes.status === "open") {
                args += ` --remove-label verify`;
            }
        }

        if (changes.title) {
            args += ` --title "${changes.title}"`;
        }

        if (changes.description) {
            const escaped = changes.description.replace(/"/g, '\\"');
            args += ` --description "${escaped}"`;
        }

        if (changes.labels) {
            for (const label of changes.labels) {
                args += ` --add-label "${label}"`;
            }
        }

        // @ts-expect-error
        if (changes.remove_labels) {
            // @ts-expect-error
            for (const label of changes.remove_labels) {
                args += ` --remove-label "${label}"`;
            }
        }

        args += ` --format json`;
        const output = await this.runCommand(args);

        // Update meta fields
        if (changes.acceptance_test) {
            const escaped = JSON.stringify(changes.acceptance_test).replace(/"/g, '\\"');
            await this.runCommand(`meta set ${id} acceptance_test "${escaped}" --format json`);
        }

        if (changes.type) {
            const escaped = JSON.stringify(changes.type).replace(/"/g, '\\"');
            await this.runCommand(`meta set ${id} type "${escaped}" --format json`);
        }

        if (changes.context) {
            const escaped = JSON.stringify(changes.context).replace(/"/g, '\\"');
            await this.runCommand(`meta set ${id} context "${escaped}" --format json`);
        }

        if (!output) return this.get(id);
        return this.parseRaw(output);
    }

    private validateTransition(current: Bead, next: BeadStatus) {
        const validTransitions: Record<BeadStatus, BeadStatus[]> = {
            open: ["in_progress", "done"],
            in_progress: ["verify", "open"],
            verify: ["done", "in_progress", "open"],
            done: ["in_progress", "open"],
        };

        if (current.status === next) return;

        const allowed = validTransitions[current.status];
        if (!allowed.includes(next)) {
            throw new Error(
                `Invalid state transition for ${current.id}: ${current.status} -> ${next}`,
            );
        }
    }

    async addDependency(childId: string, parentId: string): Promise<void> {
        await this.runCommand(`link ${childId} ${parentId} blocks`);
    }

    async addComment(id: string, comment: string): Promise<string> {
        const escaped = comment.replace(/"/g, '\\"');
        return this.runCommand(`comments add ${id} "${escaped}"`);
    }
}

// Singleton accessor
const BEADS_KEY = "beads_client";
export function getBeads(basePath?: string): BeadsClient {
    return getGlobalSingleton(BEADS_KEY, () => {
        let path = basePath;
        if (!path) {
            try {
                const config = getConfig();
                path = config.beads.path;
            } catch {
                path = ".pearls";
            }
        }
        return new BeadsClient(path);
    });
}

export function setBeadsInstance(beads: BeadsClient) {
    setGlobalSingleton(BEADS_KEY, beads);
}
