import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { tool } from 'ai';

describe('AI SDK Tool Structure Investigation', () => {
    it('should inspect the actual tool object structure', () => {
        const schema = z.object({
            formulaName: z.string(),
            variables: z.record(z.string(), z.string()).optional().default({}),
        });

        const testTool = tool({
            description: 'Test tool',
            parameters: schema,
            // biome-ignore lint/suspicious/noExplicitAny: testing
            execute: async (args: any) => args,
        });

        // Log the entire tool object to see its structure
        console.log('Tool object keys:', Object.keys(testTool));
        console.log('Tool object:', JSON.stringify(testTool, null, 2));
    });

    it('should test with z.object catchall', () => {
        const schema = z.object({
            formulaName: z.string(),
            variables: z.object({}).catchall(z.string()).optional().default({}),
        });

        const testTool = tool({
            description: 'Test with catchall',
            parameters: schema,
            // biome-ignore lint/suspicious/noExplicitAny: testing
            execute: async (args: any) => args,
        });

        console.log('\nCatchall tool:', JSON.stringify(testTool, null, 2));
    });

    it('should test making variables optional at object level', () => {
        const schema = z.object({
            formulaName: z.string(),
            variables: z.object({}).catchall(z.string()),
        }).partial({ variables: true });

        const testTool = tool({
            description: 'Test with partial',
            parameters: schema,
            // biome-ignore lint/suspicious/noExplicitAny: testing
            execute: async (args: any) => args,
        });

        console.log('\nPartial tool:', JSON.stringify(testTool, null, 2));
    });
});
