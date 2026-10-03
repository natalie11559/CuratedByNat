import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Makes sure the local D1 database has its tables before any test runs, and that .dev.vars switches on the
// development-only Studio sign-in shortcut (it works on localhost in a development build and nowhere else).
// CI=1 answers wrangler's "continue?" prompt; applying already-applied migrations is a no-op.
export default function globalSetup() {
    const devVars = `${repoRoot}.dev.vars`;
    if (!existsSync(devVars)) copyFileSync(`${repoRoot}.dev.vars.example`, devVars);
    if (!/^STUDIO_DEV_BYPASS=/m.test(readFileSync(devVars, 'utf8'))) {
        appendFileSync(devVars, '\nSTUDIO_DEV_BYPASS=1\nSTUDIO_DEV_EMAIL=hello@curatedbynat.com\n');
    }

    execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'curatedbynat-inquiries', '--local'], {
        stdio: 'pipe',
        env: { ...process.env, CI: '1' },
    });
}
