#!/usr/bin/env bun
import { Command } from 'commander';
import { loadConfig } from './config';
import { Conductor } from './services/conductor';
import { getQueue } from './core/queue';
import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';

const program = new Command();

program
    .name('citadel')
    .description('The Citadel: A deterministic agent orchestration system')
    .version('1.0.0');

// --- Init Command ---
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { getBeads } from './core/beads';

program
    .command('init')
    .description('Initialize a new Citadel project (Foundry Mode)')
    .action(async () => {
        try {
            console.log('🏗️  Initializing The Citadel...');

            const cwd = process.cwd();
            const citadelDir = join(cwd, '.citadel');
            const formulasDir = join(citadelDir, 'formulas');

            // 1. Create Directory Structure
            await mkdir(formulasDir, { recursive: true });
            console.log('✅ Created .citadel/ structure');

            // 2. Scaffold Config
            const configPath = join(cwd, 'citadel.config.ts');
            try {
                await access(configPath);
                console.log('ℹ️  citadel.config.ts already exists');
            } catch {
                const configTemplate = `
import { defineConfig } from './src/config/schema'; // Adjust import if using as package
// In a real install, you might import from 'the-citadel/config'

export default defineConfig({
    env: 'development',
    providers: {
        ollama: {
            baseURL: 'http://localhost:11434/v1',
            model: 'llama3:8b', // Default local model
        },
    },
    agents: {
        router: { provider: 'ollama', model: 'llama3:8b' },
        worker: { provider: 'ollama', model: 'llama3:8b' },
        gatekeeper: { provider: 'ollama', model: 'llama3:8b' },
        supervisor: { provider: 'ollama', model: 'llama3:8b' },
    }
});
`;
                await writeFile(configPath, configTemplate.trim());
                console.log('✅ Created citadel.config.ts (Ollama default)');
            }

            // 3. Scaffold AGENTS.md
            const agentsPath = join(cwd, 'AGENTS.md');
            try {
                await access(agentsPath);
                console.log('ℹ️  AGENTS.md already exists');
            } catch {
                const agentsTemplate = `
# Project Rules

## Setup
- Command: \`echo "No setup defined"\`

## Test
- Command: \`echo "No tests defined"\`

## Lint
- Command: \`echo "No lint defined"\`

## Behavior
- Always write a plan before coding.
`;
                await writeFile(agentsPath, agentsTemplate.trim());
                console.log('✅ Created AGENTS.md');
            }

            // 4. Scaffold Sample Formula
            const formulaPath = join(formulasDir, 'hello_world.toml');
            try {
                await access(formulaPath);
            } catch {
                const formulaTemplate = `
formula = "hello_world"
description = "A friendly greeting workflow"

[vars.name]
description = "Who to greet"
required = true
default = "World"

[[steps]]
id = "greet"
title = "Say Hello to {{name}}"
description = "Create a file named hello_{{name}}.txt with a greeting."
`;
                await writeFile(formulaPath, formulaTemplate.trim());
                console.log('✅ Created .citadel/formulas/hello_world.toml');
            }

            // 5. Initialize Beads
            console.log('🔄 Initializing Beads DB...');
            const beads = getBeads(join(cwd, '.beads'));
            await beads.init();
            console.log('✅ Beads initialized');

            console.log('\n🚀 Citadel initialized successfully!');
            console.log('Try running:');
            console.log('  bd create "Run hello_world name=Developer"');
            console.log('  citadel start');

        } catch (error) {
            console.error('❌ Init failed:', error);
            process.exit(1);
        }
    });

program
    .command('start')
    .description('Start the Citadel Conductor service')
    .action(async () => {
        try {
            await loadConfig();
            const conductor = new Conductor();

            // Handle shutdown gracefully
            process.on('SIGINT', () => {
                console.log('\nReceived SIGINT. Stopping...');
                conductor.stop();
                process.exit(0);
            });

            conductor.start();

            // Keep alive
            console.log('Citadel Conductor started. Press Ctrl+C to stop.');

            // Prevent process exit
            await new Promise(() => { });
        } catch (error) {
            console.error('Failed to start Conductor:', error);
            process.exit(1);
        }
    });

program
    .command('reset-queue [beadId]')
    .description('Reset the Work Queue (Deletes persistence file or specific bead tickets)')
    .action(async (beadId) => {
        try {
            if (beadId) {
                await loadConfig();
                const queue = getQueue();
                // Accessing private db via any for quick fix, or add method to Queue
                // Better: Add `reset(beadId)` to WorkQueue class. 
                // For now, let's use the raw DB access pattern since we are in CLI
                // biome-ignore lint/suspicious/noExplicitAny: Accessing private db for reset
                const db = (queue as any).db;
                console.log(`Resetting tickets for bead: ${beadId}...`);
                db.run("DELETE FROM tickets WHERE bead_id = ?", [beadId]);
                console.log(`Tickets for ${beadId} have been cleared.`);
            } else {
                const dbPath = resolve(process.cwd(), '.citadel', 'queue.sqlite');
                console.log(`Resetting entire queue at ${dbPath}...`);
                await unlink(dbPath);
                console.log('Queue reset successfully.');
            }
        } catch (error) {
            if (!beadId && (error as { code?: string }).code === 'ENOENT') {
                console.log('Queue file not found. Nothing to reset.');
            } else {
                console.error('Failed to reset queue:', error);
            }
        }
    });

program
    .command('inspect <beadId>')
    .description('Inspect the active ticket for a bead')
    .action(async (beadId) => {
        await loadConfig();
        const ticket = getQueue().getActiveTicket(beadId);
        if (ticket) {
            console.log(JSON.stringify(ticket, null, 2));
        } else {
            console.log(`No active ticket found for ${beadId}`);
        }
    });

program
    .command('bridge')
    .description('Start The Bridge (TUI Dashboard)')
    .action(async () => {
        const { startBridge } = await import('./bridge/index');
        await startBridge();
    });

program.parse(process.argv);
