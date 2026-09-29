import { execFileSync } from 'node:child_process';

// Makes sure the local D1 database has the inquiries table before any test sends the form.
// CI=1 answers wrangler's "continue?" prompt; applying already-applied migrations is a no-op.
export default function globalSetup() {
    execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'curatedbynat-inquiries', '--local'], {
        stdio: 'pipe',
        env: { ...process.env, CI: '1' },
    });
}
