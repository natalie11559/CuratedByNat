import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_FEED = 'https://curatedbynat.com/api/instagram/feed';
const KEY_PATTERN = /^[0-9]{5,32}\.(?:jpg|png|webp)$/;
const MAX_POSTS = 24;

/**
 * Before the site is built, downloads Nat's saved Instagram posts (the list and the pictures) from the live
 * site into `src/assets/images/instagram-feed/` and `src/generated/instagram-feed.json`. Both are git-ignored.
 * From there the pictures go through the same image pipeline as every other photo.
 *
 * It only runs in Cloudflare's builds (WORKERS_CI) or when INSTAGRAM_FEED_URL is set, so local development
 * and tests never depend on the network. "off" switches it off. If anything goes wrong the site is built
 * without the feed and the sections show the photos Nat picked in the editor.
 */
export default function instagramFeed() {
    return {
        name: 'instagram-feed',
        hooks: {
            'astro:config:setup': async ({ config, logger }) => {
                const root = fileURLToPath(config.root);
                const manifestPath = path.join(root, 'src/generated/instagram-feed.json');
                const imagesDir = path.join(root, 'src/assets/images/instagram-feed');
                const feedUrl = process.env.INSTAGRAM_FEED_URL ?? (process.env.WORKERS_CI === '1' ? PRODUCTION_FEED : '');

                await mkdir(path.dirname(manifestPath), { recursive: true });
                const hasManifest = await readFile(manifestPath, 'utf8').then(() => true, () => false);

                if (!feedUrl || feedUrl === 'off') {
                    if (!hasManifest) await writeFile(manifestPath, JSON.stringify({ syncedAt: null, posts: [] }));
                    return;
                }

                try {
                    const response = await fetch(feedUrl, { signal: AbortSignal.timeout(20_000) });
                    if (!response.ok) throw new Error(`the feed answered ${response.status}`);
                    const manifest = await response.json();
                    if (!manifest || !Array.isArray(manifest.posts)) throw new Error('the feed list was not in the expected shape');

                    const origin = new URL(feedUrl).origin;
                    const posts = [];
                    const pictures = new Map();
                    for (const post of manifest.posts.slice(0, MAX_POSTS)) {
                        if (!post || !KEY_PATTERN.test(post.key) || typeof post.permalink !== 'string') continue;
                        try {
                            const picture = await fetch(`${origin}/api/instagram/image/${post.key}`, { signal: AbortSignal.timeout(20_000) });
                            if (!picture.ok) continue;
                            pictures.set(post.key, Buffer.from(await picture.arrayBuffer()));
                            posts.push({
                                id: String(post.id),
                                key: post.key,
                                permalink: post.permalink,
                                timestamp: String(post.timestamp),
                                isVideoCover: post.isVideoCover === true,
                                alt: typeof post.alt === 'string' ? post.alt : '',
                            });
                        } catch {
                            // One picture that will not download is skipped; the rest still go through.
                        }
                    }

                    await rm(imagesDir, { recursive: true, force: true });
                    await mkdir(imagesDir, { recursive: true });
                    for (const [key, bytes] of pictures) await writeFile(path.join(imagesDir, key), bytes);
                    await writeFile(manifestPath, JSON.stringify({ syncedAt: manifest.syncedAt ?? null, posts }));
                    logger.info(`Downloaded ${posts.length} Instagram post(s).`);
                } catch (error) {
                    logger.warn(`Building without the Instagram feed: ${error instanceof Error ? error.message : error}`);
                    if (!hasManifest) await writeFile(manifestPath, JSON.stringify({ syncedAt: null, posts: [] }));
                }
            },
        },
    };
}
