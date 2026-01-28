import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import toml from '@iarna/toml';
import { logger } from './logger';

// --- Schemas ---

export const FormulaVariableSchema = z.object({
    description: z.string(),
    required: z.boolean().default(false),
    default: z.string().optional(),
});

export const FormulaStepSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    needs: z.array(z.string()).optional(), // Dependencies (other step IDs)
    // Smart Formula Extensions
    if: z.string().optional(), // Condition regex/eval string
    for: z.object({
        items: z.string(), // Variable containing the list
        as: z.string(), // Variable name for iteration
    }).optional(),
    on_failure: z.string().optional(), // Step ID to trigger if this step fails
    // Dynamic Data Piping
    output_schema: z.any().optional(), // Zod definition or JSON schema
    context: z.record(z.string(), z.string()).optional(), // Input context with {{ref}} support
});

export const FormulaSchema = z.object({
    formula: z.string(),
    description: z.string(),
    vars: z.record(z.string(), FormulaVariableSchema).optional(),
    steps: z.array(FormulaStepSchema),
});

export type Formula = z.infer<typeof FormulaSchema>;
export type FormulaStep = z.infer<typeof FormulaStepSchema>;

// --- Registry ---

export class FormulaRegistry {
    private formulas: Map<string, Formula> = new Map();
    private basePath: string;

    constructor(basePath?: string) {
        this.basePath = basePath || resolve(process.cwd(), '.citadel/formulas');
    }

    async loadAll(): Promise<void> {
        if (!existsSync(this.basePath)) {
            return;
        }

        const files = await readdir(this.basePath);
        for (const file of files) {
            if (file.endsWith('.toml')) {
                await this.loadFormula(join(this.basePath, file));
            }
        }
    }

    private async loadFormula(path: string): Promise<void> {
        try {
            const content = await readFile(path, 'utf-8');
            // Sanitize TOML output to remove potential symbols or non-standard objects
            const raw = JSON.parse(JSON.stringify(toml.parse(content)));
            const formula = FormulaSchema.parse(raw);
            this.formulas.set(formula.formula, formula);
            logger.debug(`[FormulaRegistry] Loaded formula: ${formula.formula}`);
        } catch (error) {
            logger.error(`[FormulaRegistry] Failed to load formula from ${path}:`, error);
        }
    }

    get(name: string): Formula | undefined {
        return this.formulas.get(name);
    }

    list(): Formula[] {
        return Array.from(this.formulas.values());
    }
}

// Singleton
let _registry: FormulaRegistry | null = null;
export function getFormulaRegistry(basePath?: string): FormulaRegistry {
    if (!_registry) {
        _registry = new FormulaRegistry(basePath);
    }
    return _registry;
}

export function setFormulaRegistry(registry: FormulaRegistry) {
    _registry = registry;
}
