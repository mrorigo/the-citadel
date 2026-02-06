
import { EventEmitter } from 'node:events';
import { WorkerAgent } from '../agents/worker';
import { logger } from './logger';

export class WorkerPool extends EventEmitter {
    private workers: any[] = [];
    private busyWorkers: Set<any> = new Set();
    private role: string;
    public size: number;
    private factory: (id: string) => any;

    constructor(role: string, factory: (id: string) => any, size = 1) {
        super();
        this.role = role;
        this.factory = factory;
        this.size = size;
        this.initialize();
    }

    private initialize() {
        // Clear existing if any
        this.workers = [];
        this.busyWorkers.clear();
        for (let i = 0; i < this.size; i++) {
            this.addWorker();
        }
    }

    /**
     * Dynamic Resizing
     */
    async resize(targetSize: number) {
        if (targetSize === this.size) return;

        logger.info(`[WorkerPool:${this.role}] Resizing pool from ${this.size} to ${targetSize}`);

        if (targetSize > this.size) {
            // Scale Up
            const needed = targetSize - this.size;
            for (let i = 0; i < needed; i++) {
                this.addWorker();
            }
        } else {
            // Scale Down (Graceful)
            const removeCount = this.size - targetSize;
            let removed = 0;

            // Remove idle workers first
            const idleWorkers = this.workers.filter(w => !this.busyWorkers.has(w));
            while (removed < removeCount && idleWorkers.length > 0) {
                const worker = idleWorkers.pop();
                if (worker) {
                    this.removeWorker(worker);
                    removed++;
                }
            }
        }

        this.size = targetSize;
    }

    private addWorker() {
        const id = `${this.role}-${this.workers.length + 1}-${Date.now().toString(36)}`;
        const worker = this.factory(id);
        this.workers.push(worker);

        // If worker has start method, call it
        if (worker && typeof worker.start === 'function') {
            try {
                const res = worker.start();
                if (res && typeof res.catch === 'function') {
                    res.catch((err: any) => logger.error(`[WorkerPool] Failed to start worker ${id}`, err));
                }
            } catch (err) {
                logger.error(`[WorkerPool] Failed to start worker ${id}`, err);
            }
        }
    }

    private removeWorker(worker: any) {
        const index = this.workers.indexOf(worker);
        if (index > -1) {
            this.workers.splice(index, 1);
            // If worker has stop/dispose, call it
            if (worker && typeof worker.stop === 'function') {
                worker.stop();
            }
        }
    }

    async acquire(): Promise<any> {
        // Simple FIFO / Wait strategy
        const worker = this.workers.find(w => !this.busyWorkers.has(w));
        if (worker) {
            this.busyWorkers.add(worker);
            return worker;
        }

        // Wait for worker
        return new Promise((resolve) => {
            this.once('worker_released', () => {
                this.acquire().then(resolve);
            });
        });
    }

    release(worker: any) {
        this.busyWorkers.delete(worker);
        this.emit('worker_released');
    }

    // Add start method required by Conductor
    start() {
        // If workers need explicit starting
        for (const worker of this.workers) {
            if (worker && typeof worker.start === 'function') {
                worker.start().catch((err: any) => logger.error(`[WorkerPool] Failed to start worker`, err));
            }
        }
    }

    stop() {
        for (const worker of this.workers) {
            if (worker && typeof worker.stop === 'function') {
                worker.stop();
            }
        }
        this.workers = [];
        this.busyWorkers.clear();
        this.emit('stopped');
    }

    get status() {
        return {
            total: this.workers.length,
            busy: this.busyWorkers.size,
            idle: this.workers.length - this.busyWorkers.size
        };
    }
}

// Global Singleton Pool Store
const GLOBAL_POOL_KEY = Symbol.for('citadel.pool');

export function getGlobalSingleton<T>(key: symbol, factory: () => T): T {
    const globalContext = globalThis as unknown as { __citadel_pool?: Record<symbol, unknown> };
    if (!globalContext.__citadel_pool) {
        globalContext.__citadel_pool = {};
    }

    if (!globalContext.__citadel_pool[key]) {
        globalContext.__citadel_pool[key] = factory();
    }

    return globalContext.__citadel_pool[key] as T;
}
