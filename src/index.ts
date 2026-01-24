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

program.parse(process.argv);
