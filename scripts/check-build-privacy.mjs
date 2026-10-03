// Runs after every build. Studio is private, so nothing about it may end up in the public files that Cloudflare
// serves to everyone (dist/client). Fails the build if it finds Studio's routes or names there.
// Price-like text on the public pages only prints a warning, because Nat edits those pages herself.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/client', import.meta.url));
const textFile = /\.(html|css|js|mjs|json|xml|txt|webmanifest|map|svg)$/i;
const pageFile = /\.(html|xml|txt|json|webmanifest)$/i;

// Anything here appearing in a public file means Studio code or data leaked into the public build.
const forbidden = [
    /\/api\/studio/,
    /\/studio\/app/,
    /(^|[^\w-])st-(app|nav|main|header|brand|card)\b/,
    /studioUser/,
    /ACCESS_AUD/,
    /STUDIO_ALLOWED_EMAILS/,
    /STUDIO_DEV_BYPASS/,
    /CALENDAR_FEED/,
    /(^|[^\w-])\/cal\/[\w-]/,
];
const forbiddenPaths = [/(^|\/)studio(\/|\.|$)/i, /(^|\/)cal(\/|$)/i];
const priceLike = /\$\s?\d{2,}/;

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const full = path.join(directory, entry.name);
            return entry.isDirectory() ? listFiles(full) : [full];
        }),
    );
    return nested.flat();
}

const problems = [];
const warnings = [];
let files;
try {
    files = await listFiles(root);
} catch {
    console.error(`[privacy] ${root} does not exist. Run the build first.`);
    process.exit(1);
}

for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    // robots.txt deliberately lists the private paths so search engines stay away from them.
    if (relative === 'robots.txt') continue;
    for (const pattern of forbiddenPaths) {
        if (pattern.test(relative)) problems.push(`${relative}: a file or folder named like a Studio path`);
    }
    if (!textFile.test(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
        if (pattern.test(text)) problems.push(`${relative}: matches ${pattern}`);
    }
    if (pageFile.test(file) && priceLike.test(text)) warnings.push(`${relative}: has something that looks like a price`);
}

for (const warning of warnings) console.warn(`[privacy] Warning: ${warning}. The public site should not show prices.`);
if (problems.length > 0) {
    console.error('[privacy] Studio-only text is in the public build:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log(`[privacy] OK: checked ${files.length} public files; no Studio code, routes or prices.`);
