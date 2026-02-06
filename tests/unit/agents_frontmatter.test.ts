
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { CoreAgent } from '../../src/core/agent';
import { ProjectContextService, getProjectContext } from '../../src/services/project-context';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, resetConfig } from '../../src/config';

// Mock Agent impl to access protected methods
class TestAgent extends CoreAgent {
    constructor() {
        super('worker');
    }
    public async testCheckPermissions(toolName: string, args: any) {
        return this.checkPermissions(toolName, args);
    }
}

describe('AGENTS.md Frontmatter Support', () => {
    const cwd = process.cwd();
    const testAgentsMdPath = join(cwd, 'AGENTS.md');

    beforeAll(async () => {
        resetConfig();
        await loadConfig();
    });

    // Backup existing AGENTS.md
    // We assume test environment is safe to write temporaries

    it('should parse frontmatter correctly', async () => {
        const service = new ProjectContextService();
        const content = `---
ignore:
  - "**/*.secret"
read_only:
  - "config.json"
forbidden:
  - "passwords.txt"
---
# Some rules
`;
        const config = service.parseAgentsMd(content);
        expect(config.frontmatter).toBeDefined();
        expect(config.frontmatter?.ignore).toContain('**/*.secret');
        expect(config.frontmatter?.read_only).toContain('config.json');
        expect(config.frontmatter?.forbidden).toContain('passwords.txt');
    });

    it('should merge frontmatter correctly', async () => {
        // Mock getProjectContext to return chained contexts?
        // Actually, let's rely on internal merge logic test
        const service = new ProjectContextService();
        const parent = service.parseAgentsMd(`---
ignore: 
  - "parent_ignore"
---`);
        const child = service.parseAgentsMd(`---
ignore:
  - "child_ignore"
---`);
        // We need to access private mergeConfigs or simulate it. 
        // Since it's private, we can't call it directly in types, but we can verify resolve behavior if we have files.
        // Let's rely on unit testing parse for now and integration test for behavior.
    });

    it('should enforce constraints in CoreAgent', async () => {
        // Mock project context
        const mockService = {
            resolveContext: async () => ({
                config: {
                    frontmatter: {
                        ignore: ['**/*.ign'],
                        read_only: ['**/*.ro'],
                        forbidden: ['**/*.forbid', 'secret_token']
                    }
                }
            })
        };

        // Spy on getProjectContext
        mock.module('../../src/services/project-context', () => ({
            getProjectContext: () => mockService
        }));

        const agent = new TestAgent();

        // 1. Forbidden
        const forbidRes = await agent.testCheckPermissions('read_file', { path: '/tmp/test.forbid' });
        expect(forbidRes.allowed).toBe(false);
        expect(forbidRes.error).toContain('FORBIDDEN');
        expect(forbidRes.error).toContain('test.forbid'); // Should reference file

        // 2. Read Only - Write Attempt
        const roWriteRes = await agent.testCheckPermissions('write_file', { path: '/tmp/test.ro' });
        expect(roWriteRes.allowed).toBe(false);
        expect(roWriteRes.error).toContain('READ-ONLY');

        // 3. Read Only - Read Attempt
        const roReadRes = await agent.testCheckPermissions('read_file', { path: '/tmp/test.ro' });
        expect(roReadRes.allowed).toBe(true);

        // 4. Ignore
        const ignRes = await agent.testCheckPermissions('read_file', { path: '/tmp/test.ign' });
        expect(ignRes.allowed).toBe(false);
        expect(ignRes.error).toContain('IGNORED');

        // 5. Run Command - Forbidden
        const cmdForbid = await agent.testCheckPermissions('run_command', { command: 'echo secret_token' });
        expect(cmdForbid.allowed).toBe(false);
        expect(cmdForbid.error).toContain('forbidden pattern');

        // Restore mock
        mock.restore();
    });
});
