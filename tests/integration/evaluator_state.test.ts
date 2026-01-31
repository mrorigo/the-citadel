
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BeadsClient } from '../../src/core/beads';
import { clearGlobalSingleton } from '../../src/core/registry';
import { loadConfig } from '../../src/config';

// Test suite for verifying FSM bugs reported in Evaluator
describe('Evaluator State Logic (Reproduction)', () => {
    let beads: BeadsClient;

    beforeEach(async () => {
        await loadConfig();
        clearGlobalSingleton('beads_client');
        beads = new BeadsClient();

        // Ensure clean state (using bd verify or just creating temp beads)
        // We'll create fresh beads for each test
    });

    it('should allow transitioning from verify to open (Bug 1 Fix)', async () => {
        // 1. Create bead
        const bead = await beads.create('Test Bead 1');

        // 2. Move to in_progress -> verify
        await beads.update(bead.id, { status: 'in_progress' });
        await beads.update(bead.id, { status: 'verify' });

        // 3. Attempt verify -> open (Simulating reject_work)
        await beads.update(bead.id, { status: 'open' });

        // Verify final state
        const updated = await beads.get(bead.id);
        expect(updated.status).toBe('open');
    });

    it('should allow transitioning from verify to done with failed label (Bug 2 Fix)', async () => {
        // 1. Create bead
        const bead = await beads.create('Test Bead 2');

        // 2. Move to verify
        await beads.update(bead.id, { status: 'in_progress' });
        await beads.update(bead.id, { status: 'verify' });

        // 3. Attempt verify -> done + failed (Simulating fail_work)
        await beads.update(bead.id, {
            status: 'done',
            labels: ['failed']
        });

        // Verify final state
        const updated = await beads.get(bead.id);
        expect(updated.status).toBe('done');
        expect(updated.labels).toContain('failed');
    });
});
