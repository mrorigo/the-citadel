import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { getInstructionService } from '../../src/core/instruction';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('InstructionService', () => {
    const testDir = join(process.cwd(), '.citadel/instructions');

    beforeAll(async () => {
        if (!existsSync(testDir)) {
            await mkdir(testDir, { recursive: true });
        }
    });

    afterAll(async () => {
        // Cleanup test instructions
        if (existsSync(testDir)) {
            // Only remove test files we created
            // await rm(testDir, { recursive: true });
        }
    });

    it('should build a prompt with multiple providers', async () => {
        const service = getInstructionService();

        // Mock role override
        const roleFile = join(testDir, 'role-worker.md');
        await writeFile(roleFile, '# ROLE OVERRIDE\nCustom worker rules.');

        // Mock tag override
        const tagFile = join(testDir, 'tag-git.md');
        await writeFile(tagFile, 'Git specific rules.');

        const prompt = await service.buildPrompt({
            role: 'worker',
            labels: ['tag:git'],
            context: { custom_instructions: 'Be extra careful.' }
        }, 'Base prompt.');

        expect(prompt).toContain('Base prompt.');
        expect(prompt).toContain('# ADDITIONAL INSTRUCTIONS');
        expect(prompt).toContain('Custom worker rules.');
        expect(prompt).toContain('Git specific rules.');
        expect(prompt).toContain('Be extra careful.');
        expect(prompt).toContain('# Implementation Mode'); // Builtin

        // Cleanup
        await rm(roleFile);
        await rm(tagFile);
    });

    it('should handle missing providers gracefully', async () => {
        const service = getInstructionService();
        const prompt = await service.buildPrompt({
            role: 'gatekeeper',
        }, 'Base prompt.');

        expect(prompt).toContain('Base prompt.');
        expect(prompt).toContain('# Verification Mode');
    });
});
