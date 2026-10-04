// The Worker's entry point. Astro handles every web request exactly as before; the one addition is the
// daily job that copies Nat's newest Instagram posts (see src/lib/instagram/sync.ts and wrangler.jsonc).
import { handle } from '@astrojs/cloudflare/handler';
import { syncInstagramFeed, type SyncEnv } from './lib/instagram/sync';

export default {
    fetch: handle,
    async scheduled(_controller: unknown, env: SyncEnv, context: { waitUntil(promise: Promise<unknown>): void }) {
        context.waitUntil(syncInstagramFeed(env));
    },
};
