import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { getInstructionService } from '../../src/core/instruction';
import { clearGlobalSingleton } from '../../src/core/registry';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { setConfig, resetConfig } from '../../src/config';

describe('InstructionService', () => {
    const testDir = join(process.cwd(), '.citadel/instructions');

    beforeAll(async () => {
        if (!existsSync(testDir)) {
            await mkdir(testDir, { recursive: true });
        }
    });

    beforeEach(() => {
        setConfig({
            env: 'development',
            providers: { ollama: {} },
            agents: {
                worker: { provider: 'ollama', model: 'llama3' },
                router: { provider: 'ollama', model: 'llama3' },
                gatekeeper: { provider: 'ollama', model: 'llama3' }
            },
            worker: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            gatekeeper: { min_workers: 1, max_workers: 5, load_factor: 1.0 },
            pearls: { path: '.pearls', binary: 'prl' }
        } as any);
    });

    afterEach(() => {
        resetConfig();
    });

    afterAll(async () => {
        // Cleanup test instructions
        if (existsSync(testDir)) {
            // Only remove test files we created
            // await rm(testDir, { recursive: true });
        }
        clearGlobalSingleton('instruction_service');
        clearGlobalSingleton('mcp_service');
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
