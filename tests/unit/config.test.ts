import { describe, it, expect, beforeAll } from 'bun:test';
import { loadConfig, getConfig, resetConfig } from '../../src/config';
import { getAgentModel } from '../../src/core/llm';

describe('Configuration System', () => {
    it('should load configuration successfully', async () => {
        resetConfig(); // Ensure clean state
        const config = await loadConfig();
        expect(config).toBeDefined();
        expect(config.env).toBe('development');
        expect(config.providers.ollama).toBeDefined();
    });

    it('should allow accessing config synchronously after load', () => {
        const config = getConfig();
        expect(config.worker.timeout).toBe(1200);
    });
});

describe('LLM Provider Factory', () => {
    beforeAll(async () => {
        await loadConfig();
    });

    it('should return a LanguageModel for the router agent', () => {
        const model = getAgentModel('router');
        expect(model).toBeDefined();
    });

    it('should throw error for invalid role', () => {
        // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
        expect(() => getAgentModel('invalid' as any)).toThrow();
    });
});
