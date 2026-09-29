import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the Astro dev server on Cloudflare's local runtime (workerd), so the
// inquiry API, local D1 and Turnstile test keys behave as they do in production.
// `--ignore-lock` lets this server start even when another `astro dev` is already running here.
const PORT = 4400;
const baseURL = `http://127.0.0.1:${PORT}`;

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
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npx astro dev --port ${PORT} --ignore-lock`,
        // Any page that always exists; Playwright waits until it answers with a non-error status.
        url: `${baseURL}/inquire`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
