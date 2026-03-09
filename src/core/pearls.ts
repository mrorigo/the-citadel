import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { getConfig } from "../config";
import type { CitadelConfig } from "../config/schema";
import { logger } from "./logger";
import { getGlobalSingleton, setGlobalSingleton } from "./registry";

// --- Types ---

export const PearlStatusSchema = z.enum([
    "open",
    "in_progress",
    "verify",
    "done",
]);
export type PearlStatus = z.infer<typeof PearlStatusSchema>;

export const PearlPrioritySchema = z.any().transform((val) => {
    if (typeof val === "number") return val as 0 | 1 | 2 | 3 | 4;
    if (typeof val === "string") {
        const s = val.replace(/^P/, "");
        const n = parseInt(s, 10);
        if (!Number.isNaN(n)) return n as 0 | 1 | 2 | 3 | 4;
    }
    return 2 as 0 | 1 | 2 | 3 | 4; // Default to P2
});

export type PearlPriority = z.infer<typeof PearlPrioritySchema>;

// Raw schema matching 'prl' CLI output
const RawPearlSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(), // Raw status from CLI, e.g., 'InProgress'
    priority: PearlPrioritySchema,
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

type RawPearl = z.infer<typeof RawPearlSchema>;

// Domain schema
export const PearlSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: PearlStatusSchema, // Mapped to our domain status
    priority: PearlPrioritySchema,
    assignee: z.string().optional(),
    labels: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    acceptance_test: z.string().optional(),
    parent: z.string().optional(),
    type: z.string().optional(), // Added type field
    description: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(), // New field
    created_at: z.string(),
    updated_at: z.string(),
});

export type Pearl = z.infer<typeof PearlSchema>;

export interface CreateOptions {
    priority?: 0 | 1 | 2 | 3 | 4;
    assignee?: string;
    blockers?: string[];
    acceptance_test?: string;
    description?: string;
    parent?: string; // Parent ID for molecules
    type?: string; // pearl type (epic, story, task, convoy, etc)
    context?: Record<string, unknown>;
    labels?: string[];
}

// --- Client ---

export class PearlsClient {
    private basePath: string;
    private binary: string;

    constructor(basePath?: string, binary?: string) {
        let config: CitadelConfig | null = null;
        try {
            config = getConfig();
        } catch {
            // Config might not be loaded during init
        }
        this.basePath = basePath || config?.pearls?.path || ".pearls";
        this.binary = binary || config?.pearls?.binary || "prl";
    }

    async runCommand(args: string[]): Promise<string> {
        // Determine CWD: The folder containing .pearls folder, or the basePath itself if it is the root
        const cwd = this.basePath.endsWith(".pearls")
            ? resolve(this.basePath, "..")
            : this.basePath;

        try {
            const { stdout, stderr } = await this.execute(this.binary, args, cwd);
            if (stderr && !stdout && !stderr.includes("warning")) {
                // Some tools print info to stderr?
            }
            return stdout.trim();
        } catch (error: unknown) {
            const err = error as Error;
            throw new Error(`Pearls command failed: ${this.binary} ${args.join(" ")}\n${err.message}`);
        }
    }

    async init(): Promise<void> {
        await this.runCommand(["init"]);
    }

    protected async execute(
        command: string,
        args: string[],
        cwd: string,
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { cwd });
            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            child.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            child.on("close", (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Process exited with code ${code}\n${stderr}`));
                }
            });

            child.on("error", (err) => {
                reject(err);
            });
        });
    }

    async sync(): Promise<void> {
        await this.runCommand(["sync"]);
        logger.info(`[Pearls] Database synchronized`);
    }

    async doctor(): Promise<boolean> {
        try {
            const output = await this.runCommand(["doctor", "--format", "json"]);
            return !output.toLowerCase().includes("error");
        } catch (_error) {
            return false;
        }
    }

    private parseRaw(output: string): Pearl {
        if (!output) throw new Error("Empty output from prl");
        let json: Record<string, unknown>;
        try {
            json = JSON.parse(output);
        } catch (_e) {
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
                return this.mapToDomain(RawPearlSchema.parse(json.pearls[0]));
            }
            throw new Error(`Unexpected Pearls output format: ${output}`);
        }

        const raw = RawPearlSchema.parse(pearl);
        return this.mapToDomain(raw);
    }

    private parseRawList(output: string): Pearl[] {
        if (!output) return [];
        let json: Record<string, unknown>;
        try {
            json = JSON.parse(output);
        } catch (_e) {
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
                        return this.mapToDomain(RawPearlSchema.parse(item));
                    } catch (e) {
                        console.warn(`[Pearls] Failed to parse pearl item:`, e, item);
                        return null;
                    }
                })
                .filter((b) => !!b) as Pearl[];
        }
        return [];
    }

    private mapToDomain(raw: RawPearl): Pearl {
        let status: PearlStatus = "open";

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
        const acceptance_test = raw.metadata?.acceptance_test as string | undefined;
        const type = (raw.metadata?.type || raw.metadata?.issue_type) as string | undefined;
        let context = raw.metadata?.context as Record<string, unknown> | undefined;
        const output = raw.metadata?.output;

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
            priority: raw.priority as PearlPriority,
            assignee: raw.author,
            labels: raw.labels,
            blockers,
            acceptance_test,
            parent,
            type,
            description,
            context,
            metadata: raw.metadata,
            output,
            created_at: typeof raw.created_at === "number" ? new Date(raw.created_at * 1000).toISOString() : raw.created_at,
            updated_at: typeof raw.updated_at === "number" ? new Date(raw.updated_at * 1000).toISOString() : raw.updated_at,
        };
    }

    async list(status?: PearlStatus): Promise<Pearl[]> {
        const args = ["list"];
        if (status === "done") args.push("--status", "closed");
        else if (status === "verify") args.push("--status", "in_progress");
        else if (status === "in_progress") args.push("--status", "in_progress");
        else if (status === "open") args.push("--status", "open");

        args.push("--format", "json");
        const output = await this.runCommand(args);
        const pearls = this.parseRawList(output);

        if (status) {
            return pearls.filter((b) => b.status === status);
        }
        return pearls;
    }

    async ready(): Promise<Pearl[]> {
        const output = await this.runCommand(["ready", "--format", "json"]);
        return this.parseRawList(output);
    }

    async getAll(): Promise<Pearl[]> {
        const output = await this.runCommand(["list", "--format", "json"]);
        return this.parseRawList(output);
    }

    async get(id: string): Promise<Pearl> {
        const output = await this.runCommand(["show", id, "--format", "json"]);
        return this.parseRaw(output);
    }

    async create(title: string, options: CreateOptions = {}): Promise<Pearl> {
        const args = ["create", title];
        if (options.priority !== undefined) args.push("--priority", options.priority.toString());
        if (options.description) {
            args.push("--description", options.description);
        }
        args.push("--format", "json");

        const output = await this.runCommand(args);
        const pearl = this.parseRaw(output);

        // Update metadata and links
        const updates: Record<string, unknown> = {};
        if (options.acceptance_test) updates.acceptance_test = options.acceptance_test;
        if (options.type) updates.type = options.type;
        if (options.context) updates.context = options.context;

        for (const [key, val] of Object.entries(updates)) {
            const valStr = JSON.stringify(val);
            await this.runCommand(["meta", "set", pearl.id, key, valStr, "--format", "json"]);
        }

        if (options.labels?.length) {
            for (const label of options.labels) {
                await this.runCommand(["update", pearl.id, "--add-label", label, "--format", "json"]);
            }
        }

        if (options.blockers?.length) {
            for (const blockerId of options.blockers) {
                await this.runCommand(["link", pearl.id, blockerId, "blocks", "--format", "json"]);
            }
        }

        if (options.parent) {
            await this.runCommand(["link", pearl.id, options.parent, "parent_child", "--format", "json"]);
        }

        return this.get(pearl.id);
    }

    async update(id: string, changes: Partial<Pearl>): Promise<Pearl> {
        let current: Pearl | undefined;

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

        const args = ["update", id];

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
                args.push("--status", targetCliStatus);
            }

            // Handle labels for 'verify'
            if (changes.status === "verify") {
                args.push("--add-label", "verify");
            } else if (changes.status === "in_progress") {
                args.push("--remove-label", "verify");
            } else if (changes.status === "open") {
                args.push("--remove-label", "verify");
            }
        }

        if (changes.title) {
            args.push("--title", changes.title);
        }

        if (changes.description) {
            args.push("--description", changes.description);
        }

        if (changes.labels) {
            for (const label of changes.labels) {
                args.push("--add-label", label);
            }
        }

        // @ts-expect-error
        if (changes.remove_labels) {
            // @ts-expect-error
            for (const label of changes.remove_labels) {
                args.push("--remove-label", label);
            }
        }

        args.push("--format", "json");
        const output = await this.runCommand(args);

        // Update meta fields
        if (changes.acceptance_test) {
            const valStr = JSON.stringify(changes.acceptance_test);
            await this.runCommand(["meta", "set", id, "acceptance_test", valStr, "--format", "json"]);
        }

        if (changes.type) {
            const valStr = JSON.stringify(changes.type);
            await this.runCommand(["meta", "set", id, "type", valStr, "--format", "json"]);
        }

        if (changes.context) {
            const valStr = JSON.stringify(changes.context);
            await this.runCommand(["meta", "set", id, "context", valStr, "--format", "json"]);
        }

        if (changes.output !== undefined) {
            const valStr = JSON.stringify(changes.output);
            await this.runCommand(["meta", "set", id, "output", valStr, "--format", "json"]);
        }

        let finalPearl: Pearl;
        if (!output) {
            finalPearl = await this.get(id);
        } else {
            finalPearl = this.parseRaw(output);
        }

        // --- Lifecycle Hooks ---
        if (changes.status === "done" && current?.status !== "done") {
            try {
                const config = getConfig();
                if (config.hooks?.onPearlDone) {
                    await config.hooks.onPearlDone(finalPearl);
                }
            } catch (err) {
                logger.error(`[Pearls] Error executing onPearlDone hook for ${id}:`, err);
            }
        }

        return finalPearl;
    }

    private validateTransition(current: Pearl, next: PearlStatus) {
        const validTransitions: Record<PearlStatus, PearlStatus[]> = {
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
        await this.runCommand(["link", childId, parentId, "blocks"]);
    }

    async addComment(id: string, comment: string): Promise<string> {
        return this.runCommand(["comments", "add", id, comment]);
    }

    async listComments(id: string): Promise<Array<{ author: string; content: string; created_at: string }>> {
        const output = await this.runCommand(["comments", "list", id, "--format", "json"]);
        if (!output) return [];

        try {
            const json = JSON.parse(output);
            const comments = json.comments || (Array.isArray(json) ? json : []);
            return comments.map((c: any) => ({
                author: c.author || "unknown",
                content: c.content || c.body || "",
                created_at: typeof c.created_at === "number" ? new Date(c.created_at * 1000).toISOString() : c.created_at,
            }));
        } catch (error) {
            logger.error(`[Pearls] Failed to parse comments for ${id}:`, error);
            return [];
        }
    }
}

// Singleton accessor
const PEARLS_KEY = "pearls_client";
export function getPearls(basePath?: string): PearlsClient {
    return getGlobalSingleton(PEARLS_KEY, () => {
        let path = basePath;
        if (!path) {
            try {
                const config = getConfig();
                path = config.pearls.path;
            } catch {
                path = ".pearls";
            }
        }
        return new PearlsClient(path);
    });
}

export function setPearlsInstance(pearls: PearlsClient) {
    setGlobalSingleton(PEARLS_KEY, pearls);
}
