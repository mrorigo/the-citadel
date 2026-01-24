
import { getProjectContext } from '../src/services/project-context';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

async function testProjectContext() {
    const testRoot = join(process.cwd(), '.test_agents_md');
    const subDir = join(testRoot, 'subdir');

    // Cleanup
    await rm(testRoot, { recursive: true, force: true });

    // Setup
    await mkdir(subDir, { recursive: true });

    const rootAgentsMd = `
# Rule
Always start commit with "root:"
`;
    await writeFile(join(testRoot, 'AGENTS.md'), rootAgentsMd);

    const subAgentsMd = `
# Rule
Always start commit with "sub:"
`;
    await writeFile(join(subDir, 'AGENTS.md'), subAgentsMd);

    const svc = getProjectContext();

    // Test 1: Resolve in subdir (should find subAgentsMd)
    console.log('Test 1: Resolving in subdir...');
    const ctxSub = await svc.resolveContext(subDir, testRoot);
    if (ctxSub?.config.rules.includes('Always start commit with "sub:"')) {
        console.log('PASS: Found sub AGENTS.md rule');
    } else {
        console.error('FAIL: Did not find sub AGENTS.md rule', ctxSub);
    }

    // Test 2: Resolve in root (should find rootAgentsMd)
    console.log('Test 2: Resolving in root...');
    const ctxRoot = await svc.resolveContext(testRoot, testRoot);
    if (ctxRoot?.config.rules.includes('Always start commit with "root:"')) {
        console.log('PASS: Found root AGENTS.md rule');
    } else {
        console.error('FAIL: Did not find root AGENTS.md rule', ctxRoot);
    }

    // Cleanup
    await rm(testRoot, { recursive: true, force: true });
}

testProjectContext().catch(console.error);
