
import { EventEmitter } from 'events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    meta?: Record<string, unknown>;
}

export class CitadelLogger extends EventEmitter {
    private consoleEnabled = true;

    setConsoleEnabled(enabled: boolean) {
        this.consoleEnabled = enabled;
    }

    debug(message: string, meta?: Record<string, unknown>) {
        this.log('debug', message, meta);
    }

    info(message: string, meta?: Record<string, unknown>) {
        this.log('info', message, meta);
    }

    warn(message: string, meta?: Record<string, unknown>) {
        this.log('warn', message, meta);
    }

    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
        const errMeta = error instanceof Error ? { error: error.message, stack: error.stack } : { error };
        this.log('error', message, { ...meta, ...errMeta });
    }

    private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
        const timestamp = new Date().toISOString();
        const entry: LogEntry = { timestamp, level, message, meta };

        // Emit for Bridge/TUI
        this.emit('log', entry);

        // Print to console if enabled
        if (this.consoleEnabled) {
            const metaStr = meta ? JSON.stringify(meta) : '';
            const logFn = console[level] || console.log;

            if (level === 'debug' && process.env.NODE_ENV !== 'development' && !process.env.DEBUG) {
                return;
            }
            logFn(`[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`);
        }
    }
}

export const logger = new CitadelLogger();
