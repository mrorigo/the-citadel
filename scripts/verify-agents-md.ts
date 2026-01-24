
import { getProjectContext } from '../src/services/project-context';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

async function testProjectContext() {
    console.log('Starting ProjectContext Verification...');
    const testRoot = join(process.cwd(), '.test_agents_md');
    const subDir = join(testRoot, 'subdir');

    // Cleanup
    await rm(testRoot, { recursive: true, force: true });

    // Setup
    await mkdir(subDir, { recursive: true });

    const rootAgentsMd = `
# Rule
Always start commit with "root:"

# Commands
\`npm run root-test\`
`;
    await writeFile(join(testRoot, 'AGENTS.md'), rootAgentsMd);

    const subAgentsMd = `
# Rule
Always start commit with "sub:"

# Commands
\`\`\`bash
npm run sub-test
\`\`\`
`;
    await writeFile(join(subDir, 'AGENTS.md'), subAgentsMd);

    const svc = getProjectContext();

    // Test 1: Resolve in subdir (should find sub AND root rules/commands)
    console.log('\nTest 1: Resolving in subdir (Merge Logic)...');
    const ctxSub = await svc.resolveContext(subDir, testRoot);

    // Check Rules (Merge)
    const hasSubRule = ctxSub?.config.rules.includes('Always start commit with "sub:"');
    const hasRootRule = ctxSub?.config.rules.includes('Always start commit with "root:"');

    if (hasSubRule && hasRootRule) {
        console.log('PASS: Found merged rules (sub + root)');
    } else {
        console.error('FAIL: Missing rules in merged context', { hasSubRule, hasRootRule, rules: ctxSub?.config.rules });
    }

    // Check Commands (Fenced Code Block & Merge)
    // sub-test comes from fenced block in sub
    // root-test comes from backtick in root
    const hasSubCmd = ctxSub?.config.commands.test.some(c => c.includes('sub-test'));
    const hasRootCmd = ctxSub?.config.commands.test.some(c => c.includes('root-test'));

    if (hasSubCmd) {
        console.log('PASS: Found fenced code block command (sub-test)');
    } else {
        console.error('FAIL: Did not find fenced code block command', ctxSub?.config.commands);
    }

    if (hasRootCmd) {
        console.log('PASS: Found root command (root-test) in merged context');
    } else {
        console.error('FAIL: Did not find root command', ctxSub?.config.commands);
    }

    // Cleanup
    await rm(testRoot, { recursive: true, force: true });
}

testProjectContext().catch(console.error);
