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
    .command('reset-queue')
    .description('Reset the Work Queue (Deletes persistence file)')
    .action(async () => {
        try {
            const dbPath = resolve(process.cwd(), '.citadel', 'queue.sqlite');
            console.log(`Resetting queue at ${dbPath}...`);
            await unlink(dbPath);
            console.log('Queue reset successfully.');
        } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') {
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
