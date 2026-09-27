// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import node from '@astrojs/node';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import sitemap from '@astrojs/sitemap';
import pruneUnreferencedImages from './integrations/prune-unreferenced-images.mjs';

// `npm run dev:cms` edits content files locally with Keystatic, which needs Node's file
// system, so that mode swaps in the Node adapter. Everything else runs on Cloudflare's runtime.
const isLocalCms = process.env.PUBLIC_KEYSTATIC_STORAGE === 'local';

export default defineConfig({
    site: 'https://curatedbynat.com',
    output: 'static',
    trailingSlash: 'never',
    session: false,
    adapter: isLocalCms
        ? node({ mode: 'standalone' })
        : cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }),
    integrations: [
        react(),
        keystatic(),
        sitemap({ filter: (page) => !page.includes('/keystatic') }),
        pruneUnreferencedImages(),
    ],
});
