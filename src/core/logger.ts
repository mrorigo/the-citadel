import { EventEmitter } from 'node:events';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    // biome-ignore lint/suspicious/noExplicitAny: Meta can be anything
    meta?: any;
}

class CitadelLogger extends EventEmitter {
    private static instance: CitadelLogger;

    private constructor() {
        super();
    }

    static getInstance(): CitadelLogger {
        if (!CitadelLogger.instance) {
            CitadelLogger.instance = new CitadelLogger();
        }
        return CitadelLogger.instance;
    }

    private consoleEnabled = true;

    public setConsoleEnabled(enabled: boolean) {
        this.consoleEnabled = enabled;
    }

    log(level: LogLevel, message: string, meta?: unknown) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            meta,
        };

        // Emit event for TUI
        this.emit('log', entry);

        // Print to console if enabled
        if (this.consoleEnabled) {
            const output = `[${entry.timestamp}] [${level.toUpperCase()}] ${message}`;
            if (level === 'error') {
                console.error(output, meta || '');
            } else {
                console.log(output, meta || '');
            }
        }
    }

    info(message: string, meta?: unknown) {
        this.log('info', message, meta);
    }

    warn(message: string, meta?: unknown) {
        this.log('warn', message, meta);
    }

    error(message: string, meta?: unknown) {
        this.log('error', message, meta);
    }

    debug(message: string, meta?: unknown) {
        this.log('debug', message, meta);
    }
}

export const logger = CitadelLogger.getInstance();
