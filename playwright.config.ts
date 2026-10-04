import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the Astro dev server on Cloudflare's local runtime (workerd), so the
// inquiry API, local D1 and Turnstile test keys behave as they do in production.
// `--ignore-lock` lets this server start even when another `astro dev` is already running here.
const PORT = 4400;
const baseURL = `http://127.0.0.1:${PORT}`;
// The "locked" checks run against the production build (with the dev shortcut still switched on in
// .dev.vars) to prove Studio stays closed outside development.
const LOCKED_PORT = 4401;
const lockedURL = `http://127.0.0.1:${LOCKED_PORT}`;

export default defineConfig({
    testDir: 'tests/e2e',
    globalSetup: './tests/e2e/global-setup.ts',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL,
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', testIgnore: /locked/, use: { ...devices['Desktop Chrome'] } },
        { name: 'locked', testMatch: /locked/, use: { ...devices['Desktop Chrome'], baseURL: lockedURL } },
    ],
    // Playwright starts these one after the other. The production build goes first: a build that ran while the
    // development server was up would make it restart with the built configuration, which has none of the
    // local bindings.
    webServer: [
        {
            command: `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build && npx wrangler dev --port ${LOCKED_PORT}`,
            url: `${lockedURL}/inquire`,
            reuseExistingServer: !process.env.CI,
            timeout: 300_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
        {
            command: `npx astro dev --port ${PORT} --ignore-lock`,
            // Any page that always exists; Playwright waits until it answers with a non-error status.
            url: `${baseURL}/inquire`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],
});
