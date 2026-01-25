
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class CitadelLogger {
    private static instance: CitadelLogger;

    // In the future, this could emit events to the TUI
    // For now, it wraps console to allow centralized control

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
        const metaStr = meta ? JSON.stringify(meta) : '';

        // Use console methods for proper stdio streams
        const logFn = console[level] || console.log;

        if (level === 'debug' && process.env.NODE_ENV !== 'development' && !process.env.DEBUG) {
            return;
        }

        logFn(`[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`);
    }
}

export const logger = new CitadelLogger();
