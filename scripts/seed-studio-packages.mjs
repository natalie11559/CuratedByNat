// Loads Nat's package and extras price lists into Studio from a private file, so prices never sit in the
// (public) repository.
//
//   npm run studio:seed -- --local     the local development database
//   npm run studio:seed -- --remote    the live database (run this yourself, on purpose)
//
// The file is studio-seed.local.json in the project folder (git-ignored). See studio-seed.example.json for its
// shape. Running it again adds only what is missing, matched by name, and never changes a price that exists.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null;
if (!target) {
    console.error('Say where to load it: npm run studio:seed -- --local   or   npm run studio:seed -- --remote');
    process.exit(1);
}

let seed;
try {
    seed = JSON.parse(readFileSync(join(root, 'studio-seed.local.json'), 'utf8'));
} catch {
    console.error('studio-seed.local.json is missing or is not valid JSON. See studio-seed.example.json.');
    process.exit(1);
}

const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;
const cents = (dollars) => {
    const value = Math.round(Number(dollars) * 100);
    if (!Number.isInteger(value) || value < 0) throw new Error(`Not a price: ${dollars}`);
    return value;
};
const now = new Date().toISOString();
const statements = [];

(seed.packages ?? []).forEach((item, index) => {
    const details = [...(item.details ?? []), ...(seed.includedInAll ?? [])];
    statements.push(
        `INSERT INTO packages (id, name, price_cents, details, sort_order, active, created_at, updated_at)
         SELECT ${sql(randomUUID())}, ${sql(item.name)}, ${cents(item.price)}, ${sql(JSON.stringify(details))}, ${(index + 1) * 10}, 1, ${sql(now)}, ${sql(now)}
         WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = ${sql(item.name)});`,
    );
});
(seed.extras ?? []).forEach((item, index) => {
    statements.push(
        `INSERT INTO extras (id, name, price_cents, sort_order, active, created_at, updated_at)
         SELECT ${sql(randomUUID())}, ${sql(item.name)}, ${cents(item.price)}, ${(index + 1) * 10}, 1, ${sql(now)}, ${sql(now)}
         WHERE NOT EXISTS (SELECT 1 FROM extras WHERE name = ${sql(item.name)});`,
    );
});

if (statements.length === 0) {
    console.error('Nothing to load: the seed file has no packages or extras.');
    process.exit(1);
}

const file = join(mkdtempSync(join(tmpdir(), 'studio-seed-')), 'seed.sql');
writeFileSync(file, `${statements.join('\n')}\n`);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'curatedbynat-inquiries', target, '--file', file], { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' } });
console.log(`Loaded ${seed.packages?.length ?? 0} package(s) and ${seed.extras?.length ?? 0} extra(s) (existing names were left as they are).`);
