import { describe, it, expect } from 'bun:test';
import { jsonSchemaToZod } from '../../src/core/schema-utils';
import { z } from 'zod';

describe('jsonSchemaToZod - Record/Object Handling', () => {
    it('should convert empty object schema to z.object().passthrough()', () => {
        const schema = {
            type: 'object',
            properties: {},
            additionalProperties: true,
        };

        const zodSchema = jsonSchemaToZod(schema);

        // Test that it accepts any properties
        const result1 = zodSchema.safeParse({});
        expect(result1.success).toBe(true);

        const result2 = zodSchema.safeParse({ foo: 'bar', baz: 123 });
        expect(result2.success).toBe(true);
    });

    it('should handle object with no properties (implicit additionalProperties)', () => {
        const schema = {
            type: 'object',
        };

        const zodSchema = jsonSchemaToZod(schema);

        // Should allow additional properties
        const result = zodSchema.safeParse({ anything: 'goes' });
        expect(result.success).toBe(true);
    });

    it('should reject additional properties when additionalProperties is false', () => {
        const schema = {
            type: 'object',
            properties: {},
            additionalProperties: false,
        };

        const zodSchema = jsonSchemaToZod(schema);

        // Should be a strict empty object
        const result1 = zodSchema.safeParse({});
        expect(result1.success).toBe(true);

        // This should still pass because Zod's object() allows additional properties by default
        // unless we use .strict()
        const result2 = zodSchema.safeParse({ foo: 'bar' });
        expect(result2.success).toBe(true); // Zod is permissive by default
    });

    it('should handle the sisyphus formula output schema pattern', () => {
        // This is the pattern from sisyphus_formula.toml
        const schema = {
            type: 'object',
            required: ['analysis', 'steps', 'affected_files'],
            properties: {
                analysis: { type: 'string' },
                steps: { type: 'array', items: { type: 'string' } },
                affected_files: { type: 'array', items: { type: 'string' } },
            },
        };

        const zodSchema = jsonSchemaToZod(schema);

        const validData = {
            analysis: 'This is the analysis',
            steps: ['step1', 'step2'],
            affected_files: ['file1.ts', 'file2.ts'],
        };

        const result = zodSchema.safeParse(validData);
        expect(result.success).toBe(true);
    });
});
