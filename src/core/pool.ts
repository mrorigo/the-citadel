import type { Hook } from './hooks';
import { logger } from './logger';

export type HookFactory = (id: string) => Hook;

export class WorkerPool {
    private hooks: Hook[] = [];
    private role: string;
    private factory: HookFactory;

    constructor(role: string, factory: HookFactory, initialSize: number = 1) {
        this.role = role;
        this.factory = factory;
        this.resize(initialSize);
    }

    get size(): number {
        return this.hooks.length;
    }

    /**
     * Adjust the number of active workers in the pool.
     */
    async resize(targetSize: number) {
        if (targetSize === this.size) return;

        logger.info(`[WorkerPool:${this.role}] Resizing pool from ${this.size} to ${targetSize}`);

        if (targetSize > this.size) {
            // Grow
            const countToAdd = targetSize - this.size;
            for (let i = 0; i < countToAdd; i++) {
                // const id = `${this.role}-${this.size + 1}`; // Unused
                // Note: unique IDs might need better handling if we shrink and grow repeatedly
                // Usage of timestamp or random suffix would be safer
                const uniqueId = `${this.role}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                const hook = this.factory(uniqueId);
                hook.start();
                this.hooks.push(hook);
            }
        } else {
            // Shrink
            const countToRemove = this.size - targetSize;
            for (let i = 0; i < countToRemove; i++) {
                const hook = this.hooks.pop();
                if (hook) {
                    hook.stop();
                }
            }
        }
    }

    /**
     * Stop all workers
     */
    stop() {
        this.resize(0);
    }

    start() {
        // If we were at 0, maybe we should restore? 
        // For now, resize to 1 if empty, or let conductor manage it.
        // Actually, start just ensures existing hooks are running?
        // Hook.start is idempotent.
        this.hooks.forEach(h => { h.start(); });
    }
}
