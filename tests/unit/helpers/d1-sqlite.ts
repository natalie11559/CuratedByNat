// A stand-in for Cloudflare D1 built on Node's own SQLite, so tests run the real migration files and real SQL
// (partial unique indexes, JSON functions, transactions) instead of a hand-written fake.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1Statement } from '../../../src/lib/cloudflare.ts';

const migrationsDirectory = new URL('../../../migrations/', import.meta.url);

type SqlValue = string | number | null;

export interface TestD1 extends D1Database {
    /** Direct access for assertions. */
    raw: DatabaseSync;
}

/**
 * D1 numbers its placeholders (?1, ?2, and the same one may be used twice); node:sqlite only binds plain `?`.
 * This rewrites each ?N to ? and lists the values in the order the placeholders appear.
 */
function positional(query: string, values: SqlValue[]): { sql: string; values: SqlValue[] } {
    const ordered: SqlValue[] = [];
    const sql = query.replace(/\?(\d+)/g, (_match, index: string) => {
        const value = values[Number(index) - 1];
        if (value === undefined) throw new Error(`No value bound for ?${index}`);
        ordered.push(value);
        return '?';
    });
    return { sql, values: ordered };
}

function clean(values: unknown[]): SqlValue[] {
    return values.map((value) => {
        if (value === undefined || value === null) return null;
        if (typeof value === 'boolean') return value ? 1 : 0;
        return value as SqlValue;
    });
}

export function createTestD1(options: { migrations?: string[] } = {}): TestD1 {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');

    const files = readdirSync(migrationsDirectory)
        .filter((name) => name.endsWith('.sql'))
        .filter((name) => !options.migrations || options.migrations.includes(name))
        .sort();
    for (const name of files) raw.exec(readFileSync(new URL(name, migrationsDirectory), 'utf8'));

    function statement(query: string, values: SqlValue[] = []): D1Statement & { execute(): void } {
        return {
            bind(...next: unknown[]) {
                return statement(query, clean(next));
            },
            async run() {
                const bound = positional(query, values);
                raw.prepare(bound.sql).run(...bound.values);
                return {};
            },
            async first<T>() {
                const bound = positional(query, values);
                return (raw.prepare(bound.sql).get(...bound.values) as T | undefined) ?? null;
            },
            async all<T>() {
                const bound = positional(query, values);
                return { results: raw.prepare(bound.sql).all(...bound.values) as T[] };
            },
            execute() {
                const bound = positional(query, values);
                raw.prepare(bound.sql).run(...bound.values);
            },
        };
    }

    return {
        raw,
        prepare: (query: string) => statement(query),
        async batch(statements: D1Statement[]) {
            raw.exec('BEGIN');
            try {
                for (const item of statements) (item as ReturnType<typeof statement>).execute();
                raw.exec('COMMIT');
            } catch (error) {
                raw.exec('ROLLBACK');
                throw error;
            }
            return statements.map(() => ({}));
        },
    };
}
