import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './logger';

export function getIgnoredPatterns(baseDir: string = process.cwd()): string[] {
    const gitignorePath = resolve(baseDir, '.gitignore');
    const ignored: Set<string> = new Set();

    // Standard hardcoded ignores (Safety Net)
    ignored.add('node_modules');
    ignored.add('.git');
    ignored.add('.env');
    ignored.add('.DS_Store');
    ignored.add('dist');
    ignored.add('build');
    ignored.add('coverage');

    if (existsSync(gitignorePath)) {
        try {
            const content = readFileSync(gitignorePath, 'utf-8');
            const lines = content.split('\n');
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('#')) continue;

                // Keep the pattern raw, let the tool handle matching logic if possible
                // but commonly we want to strip leading slashes for some matchers
                // For now, keep it simple.
                ignored.add(line);
            }
            logger.debug(`[GitIgnore] Loaded ${ignored.size} patterns from ${gitignorePath}`, { patterns: Array.from(ignored) });
        } catch (error) {
            logger.warn(`[GitIgnore] Failed to read .gitignore: ${error}`);
        }
    }

    return Array.from(ignored);
}
