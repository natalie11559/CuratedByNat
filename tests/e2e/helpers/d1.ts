import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Runs SQL against the local database the development server uses. Several tests do this at once and SQLite briefly
 * locks the file, so a failed attempt is simply tried again.
 */
export function runLocalD1<T = Record<string, unknown>>(sql: string): T[] {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const output = execFileSync('npx', ['wrangler', 'd1', 'execute', 'curatedbynat-inquiries', '--local', '--json', '--command', sql], {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            return JSON.parse(output)[0].results;
        } catch (error) {
            lastError = error;
            execFileSync('sleep', ['0.5']);
        }
    }
    throw lastError;
}
