import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const imagePattern = /\.(jpe?g|png|webp|avif|gif|heic)$/i;
const textPattern = /\.(html|css|js|mjs|json|xml|webmanifest|txt)$/i;

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const fullPath = path.join(directory, entry.name);
            return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
        }),
    );
    return files.flat();
}

/**
 * Astro copies the original of every imported photo into the build, even when a page only uses
 * resized versions. Originals can be large and can carry phone metadata such as GPS location,
 * so after the build we delete any image under `_astro/` that no page, stylesheet or script references.
 */
export default function pruneUnreferencedImages() {
    return {
        name: 'prune-unreferenced-images',
        hooks: {
            'astro:build:done': async ({ dir, logger }) => {
                const outputDirectory = fileURLToPath(dir);
                const files = await listFiles(outputDirectory);
                const referenceText = (
                    await Promise.all(files.filter((file) => textPattern.test(file)).map((file) => readFile(file, 'utf8')))
                ).join('\n');

                const assetImages = files.filter(
                    (file) => imagePattern.test(file) && file.includes(`${path.sep}_astro${path.sep}`),
                );
                let removed = 0;
                for (const file of assetImages) {
                    if (!referenceText.includes(path.basename(file))) {
                        await unlink(file);
                        removed += 1;
                    }
                }
                logger.info(`Removed ${removed} unreferenced original image(s) from the build.`);
            },
        },
    };
}
