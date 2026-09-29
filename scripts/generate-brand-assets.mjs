// Generates the favicons, app icons and social share image in public/ from the
// Cn monogram (src/assets/images/logo-cn.png). Run with `node scripts/generate-brand-assets.mjs`
// after the logo changes, then commit the files it writes.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const logoPath = path.join(rootDirectory, 'src/assets/images/logo-cn.png');
const publicDirectory = path.join(rootDirectory, 'public');
const fontsDirectory = path.join(publicDirectory, 'fonts');

const brand = {
    name: 'Curated by Nat',
    tagline: 'Weddings | Weekends | Celebrations',
    background: '#F8F4EE',
    backgroundAlt: '#F9E8E4',
    text: '#2B2B2B',
    textMuted: '#6B6260',
    border: '#E4D5D0',
    accent: '#D48A95',
};

const publicPath = (fileName) => path.join(publicDirectory, fileName);

async function logoAtSize(size) {
    return sharp(logoPath).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

/** The monogram centered on a solid square, so no platform fills the transparent corners with black. */
async function logoOnSquare(canvasSize, logoSize) {
    const logo = await logoAtSize(logoSize);
    const composed = await sharp({
        create: { width: canvasSize, height: canvasSize, channels: 3, background: brand.background },
    })
        .composite([{ input: logo, gravity: 'center' }])
        .png()
        .toBuffer();
    // Compositing adds an alpha channel; drop it so the file is a plain opaque RGB PNG.
    return sharp(composed).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Minimal ICO encoder. Modern ICO files may store each size as a complete PNG, so the file is a
 * 6-byte header, one 16-byte directory entry per image, then the PNG bytes back to back.
 */
function encodeIco(images) {
    const headerSize = 6;
    const entrySize = 16;
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type 1 = icon
    header.writeUInt16LE(images.length, 4);

    let offset = headerSize + entrySize * images.length;
    const entries = images.map(({ size, png }) => {
        const entry = Buffer.alloc(entrySize);
        entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
        entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
        entry.writeUInt8(0, 2); // palette colors (none)
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += png.length;
        return entry;
    });

    return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function writeFavicons() {
    const favicon16 = await sharp(logoPath).resize(16, 16, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    const favicon32 = await sharp(logoPath).resize(32, 32, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(publicPath('favicon.ico'), encodeIco([
        { size: 16, png: favicon16 },
        { size: 32, png: favicon32 },
    ]));
    await writeFile(publicPath('favicon-32x32.png'), favicon32);
}

async function writeAppIcons() {
    // iOS rounds the corners itself and turns transparency black, so the mark sits on a solid square.
    await writeFile(publicPath('apple-touch-icon.png'), await logoOnSquare(180, 148));

    // Android masks icons to shapes as small as a circle 80% of the icon's width (the "safe zone").
    // At 72% the whole monogram survives any mask, and the padding still looks deliberate unmasked.
    await writeFile(publicPath('icon-192.png'), await logoOnSquare(192, 138));
    await writeFile(publicPath('icon-512.png'), await logoOnSquare(512, 368));
}

async function dataUri(filePath, mimeType) {
    return `data:${mimeType};base64,${(await readFile(filePath)).toString('base64')}`;
}

// The motif icons from src/components/MotifIcon.astro.
const motifPaths = {
    coupe: ['M4.5 5h15c0 4.2-3.4 6.5-7.5 6.5S4.5 9.2 4.5 5z', 'M12 11.5V19', 'M8 19.5h8'],
    bow: [
        'M12 10.5C10 7.5 5 5.5 3.5 7.5S4.5 14 8 13l4-2.5z',
        'M12 10.5c2-3 7-5 8.5-3S19.5 14 16 13l-4-2.5z',
        'M11 11.5l-2.5 7.5',
        'M13 11.5l2.5 7.5',
    ],
    heart: ['M12 19.5s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10.2-7.5 10.2z'],
    heel: [
        'M3 18.5h9.5l3.5-6c1-1.6 2.3-2.5 4-2.5V6.5h-2c-2.3 0-3.6 1.3-5 3.5l-2 3c-1 1.5-2.5 2.2-4.3 2.2C4.5 15.2 3 16.5 3 18.5z',
        'M20 10v8.5',
    ],
};

function motifIcon(name) {
    const paths = motifPaths[name].map((d) => `<path d="${d}"/>`).join('');
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

async function socialImageHtml() {
    const caslon = await dataUri(path.join(fontsDirectory, 'libre-caslon-display-400.woff2'), 'font/woff2');
    const mulish = await dataUri(path.join(fontsDirectory, 'mulish-variable.woff2'), 'font/woff2');
    const logo = await dataUri(logoPath, 'image/png');
    const motifs = ['coupe', 'bow', 'heart', 'heel'].map(motifIcon).join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
    @font-face { font-family: 'Libre Caslon Display'; font-weight: 400; src: url(${caslon}) format('woff2'); }
    @font-face { font-family: 'Mulish'; font-weight: 400 600; src: url(${mulish}) format('woff2'); }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body {
        background: ${brand.backgroundAlt};
        -webkit-font-smoothing: antialiased;
        display: flex;
    }
    .panel {
        margin: 36px;
        flex: 1;
        background: ${brand.background};
        border: 1px solid ${brand.border};
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }
    .logo { width: 176px; height: 176px; display: block; }
    .wordmark {
        margin-top: 36px;
        font-family: 'Libre Caslon Display', serif;
        font-size: 68px;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: ${brand.text};
    }
    .motifs {
        margin-top: 30px;
        display: flex;
        align-items: center;
        gap: 24px;
        color: ${brand.accent};
    }
    .motifs__line { width: 120px; height: 1px; background: ${brand.border}; }
    .motifs__icons { display: flex; gap: 20px; }
    .motifs svg { display: block; }
    .tagline {
        margin-top: 30px;
        font-family: 'Mulish', sans-serif;
        font-weight: 500;
        font-size: 17px;
        line-height: 1;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: ${brand.textMuted};
        /* Letter spacing trails the last letter, so shift back by half of it to stay optically centered. */
        margin-right: -0.3em;
    }
</style>
</head>
<body>
    <div class="panel">
        <img class="logo" src="${logo}" alt="">
        <div class="wordmark">${brand.name}</div>
        <div class="motifs" aria-hidden="true">
            <span class="motifs__line"></span>
            <span class="motifs__icons">${motifs}</span>
            <span class="motifs__line"></span>
        </div>
        <div class="tagline">${brand.tagline}</div>
    </div>
</body>
</html>`;
}

async function writeSocialImage() {
    const browser = await chromium.launch();
    try {
        // Rendered at 2x and scaled down for smoother type than a 1x screenshot.
        const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
        await page.setContent(await socialImageHtml(), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const fontsLoaded = await page.evaluate(
            () =>
                document.fonts.check('68px "Libre Caslon Display"') && document.fonts.check('500 17px "Mulish"'),
        );
        if (!fontsLoaded) {
            throw new Error('The brand fonts did not load, so the share image would use fallback fonts.');
        }
        const screenshot = await page.screenshot({ type: 'png' });
        const jpeg = await sharp(screenshot)
            .resize(1200, 630, { kernel: 'lanczos3' })
            .jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' })
            .toBuffer();
        if (jpeg.length > 300 * 1024) {
            throw new Error(`og-image.jpg is ${Math.round(jpeg.length / 1024)} KB; keep it under 300 KB.`);
        }
        await writeFile(publicPath('og-image.jpg'), jpeg);
    } finally {
        await browser.close();
    }
}

await writeFavicons();
await writeAppIcons();
await writeSocialImage();

console.log('Wrote favicon.ico, favicon-32x32.png, apple-touch-icon.png, icon-192.png, icon-512.png and og-image.jpg to public/.');
