// WCAG 2.1 contrast check for every text/background pair the site uses (design-spec section 1),
// read from the hex values in src/styles/tokens.css, plus a scan that fails if the decorative
// logo rose (--color-accent, #D48A95) is ever used as a text color.
// Run with `npm run check:contrast`. Exits with code 1 on any failure.
//
// The motif icons, the testimonial quote mark and other decorative marks are drawn in the logo
// rose on purpose (spec sections 1 and 3), often through `color` + `currentColor`. A rose `color`
// declaration counts as decorative, is listed for review and does not fail, when any of these hold:
//   - the CSS selector names a mark: icon, motif, mark, glyph, ornament or ring;
//   - an inline style sits on an element with aria-hidden="true";
//   - the line carries a comment containing "decorative", e.g. `color: var(--color-accent); /* decorative */`.
// Every other rose `color` declaration fails.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const tokensPath = path.join(rootDirectory, 'src/styles/tokens.css');
const sourceDirectory = path.join(rootDirectory, 'src');

// WCAG 2.1 minimums: 1.4.3 (normal and large text) and 1.4.11 (UI components and graphics).
const minimums = { text: 4.5, large: 3, ui: 3 };

/**
 * Every foreground/background pair on the site. `kind` sets the minimum: 'text' for normal text,
 * 'large' for text at least 24px (or 18.66px bold, unused here), 'ui' for borders and
 * incidental text that only needs to be perceivable (placeholder and disabled states).
 */
const pairs = [
    // Headings and primary text
    { fg: '--color-text', bg: '--color-bg', kind: 'text', use: 'Headings and primary text on the base ground' },
    { fg: '--color-text', bg: '--color-bg-alt', kind: 'text', use: 'Headings and primary text on blush sections' },
    { fg: '--color-text', bg: '--color-surface', kind: 'text', use: 'Typed text in white form fields' },
    { fg: '--color-text', bg: '--color-error-tint', kind: 'text', use: 'Primary text beside the error summary' },
    // Muted text: body copy, eyebrows, helper text, legal line, "(optional)"
    { fg: '--color-text-muted', bg: '--color-bg', kind: 'text', use: 'Body copy, eyebrows and helper text on base' },
    { fg: '--color-text-muted', bg: '--color-bg-alt', kind: 'text', use: 'Body copy, eyebrows, footer legal on blush' },
    { fg: '--color-text-muted', bg: '--color-surface', kind: 'text', use: 'Checkbox option detail line on white rows' },
    { fg: '--color-text-muted', bg: '--color-surface', kind: 'text', use: 'Placeholder and "Choose one" in white fields' },
    // Rose text: script accents, step numerals, link hover, focus ring
    { fg: '--color-accent-text', bg: '--color-bg', kind: 'text', use: 'Rose link hover and signature on base' },
    { fg: '--color-accent-text', bg: '--color-bg-alt', kind: 'text', use: 'Rose step numerals and link hover on blush' },
    { fg: '--color-accent-text', bg: '--color-bg', kind: 'ui', use: 'Focus ring on base' },
    { fg: '--color-accent-text', bg: '--color-bg-alt', kind: 'ui', use: 'Focus ring on blush' },
    // Error and success
    { fg: '--color-error', bg: '--color-surface', kind: 'text', use: 'Field error text next to white fields' },
    { fg: '--color-error', bg: '--color-bg', kind: 'text', use: 'Field error messages on the base ground' },
    { fg: '--color-error', bg: '--color-error-tint', kind: 'text', use: 'Error summary text on its tint' },
    { fg: '--color-error', bg: '--color-surface', kind: 'ui', use: 'Error border on white fields' },
    { fg: '--color-success', bg: '--color-bg', kind: 'text', use: 'Success text on base' },
    { fg: '--color-success', bg: '--color-surface', kind: 'text', use: 'Success text on white' },
    // Buttons
    { fg: '--color-on-dark', bg: '--color-button', kind: 'text', use: 'Primary and photo button label' },
    { fg: '--color-on-dark', bg: '--color-button-hover', kind: 'text', use: 'Button label on hover' },
    { fg: '--color-on-dark', bg: '--color-button-pressed', kind: 'text', use: 'Button label when pressed' },
    { fg: '--color-button', bg: '--color-bg', kind: 'text', use: 'Outline button label and links on base' },
    { fg: '--color-button', bg: '--color-bg-alt', kind: 'text', use: 'Outline button label and links on blush' },
    { fg: '--color-button-hover', bg: '--color-bg', kind: 'text', use: 'Link hover color on base' },
    { fg: '--color-button', bg: '--color-bg', kind: 'ui', use: 'Outline button border, checked checkbox on base' },
    { fg: '--color-button', bg: '--color-surface', kind: 'ui', use: 'Checked checkbox box on white' },
    { fg: '--color-on-dark', bg: '--color-button', kind: 'ui', use: 'Checkmark inside a checked box' },
    // Form fields and disabled state
    { fg: '--color-border-field', bg: '--color-surface', kind: 'ui', use: 'Input, select and checkbox borders on white' },
    { fg: '--color-border-field', bg: '--color-bg', kind: 'ui', use: 'Checkbox border next to the base ground' },
    { fg: '--color-disabled-text', bg: '--color-disabled-bg', kind: 'ui', use: 'Disabled field text (exempt; checked at 3:1)' },
    { fg: '--color-disabled-text', bg: '--color-bg', kind: 'ui', use: 'Disabled field label on base (exempt; 3:1)' },
    // Text on the Home hero script and photo overlays is checked by eye against the photo (spec section 1).
];

const hexPattern = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

async function readTokens() {
    const css = await readFile(tokensPath, 'utf8');
    // Only the first :root block, before any media query overrides.
    const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
    const tokens = new Map();
    for (const match of rootBlock.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
        tokens.set(match[1], match[2].toUpperCase());
    }
    return tokens;
}

function hexToRgb(hex) {
    let digits = hex.slice(1);
    if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join('');
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex) {
    const [red, green, blue] = hexToRgb(hex).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
    const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
}

async function listSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) return listSourceFiles(fullPath);
            return /\.(astro|css)$/.test(entry.name) ? [fullPath] : [];
        }),
    );
    return nested.flat();
}

const decorativeSelector = /icon|motif|mark|glyph|ornament|ring/i;
const decorativeComment = /\/\*[^*]*decorative|<!--[^>]*decorative|\/\/.*decorative/i;

/** The selector of the CSS rule whose block contains `index`, or null when `index` is not in a rule block. */
function enclosingSelector(source, index) {
    const blockStart = source.lastIndexOf('{', index);
    if (blockStart === -1 || source.lastIndexOf('}', index) > blockStart) return null;
    const selectorStart = Math.max(
        source.lastIndexOf('}', blockStart - 1),
        source.lastIndexOf('{', blockStart - 1),
        source.lastIndexOf('>', blockStart - 1),
    );
    return source
        .slice(selectorStart + 1, blockStart)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
}

/** The opening tag around `index` when it sits inside an inline style attribute, otherwise null. */
function enclosingInlineTag(source, index) {
    const tagStart = source.lastIndexOf('<', index);
    if (tagStart === -1 || source.lastIndexOf('>', index) > tagStart) return null;
    const tagEnd = source.indexOf('>', index);
    const tag = source.slice(tagStart, tagEnd === -1 ? undefined : tagEnd + 1);
    return /\sstyle\s*=/.test(tag) ? tag : null;
}

/**
 * Finds `color:` declarations (not background-color, border-color, etc.) that use the logo rose,
 * in stylesheets and inline style attributes, and sorts them into decorative uses and failures.
 */
async function findAccentColorDeclarations() {
    const accentAsColor = /(?<![\w-])color\s*:\s*[^;"'}]*(?:var\(\s*--color-accent\s*\)|#D48A95\b)/gi;
    const problems = [];
    const allowed = [];
    for (const file of await listSourceFiles(sourceDirectory)) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(accentAsColor)) {
            const lineNumber = source.slice(0, match.index).split('\n').length;
            const lineText = source.split('\n')[lineNumber - 1];
            const finding = { file: path.relative(rootDirectory, file), line: lineNumber, text: match[0].trim() };
            const inlineTag = enclosingInlineTag(source, match.index);
            const selector = inlineTag ? null : enclosingSelector(source, match.index);
            // Only the element the rule styles matters, not its ancestors in the selector.
            const target = selector?.split(',').map((part) => part.trim().split(/\s+|>|\+|~/).pop() ?? '').join(', ');
            if (decorativeComment.test(lineText)) {
                allowed.push({ ...finding, reason: 'marked decorative' });
            } else if (inlineTag && /aria-hidden\s*=\s*["']?true/.test(inlineTag)) {
                allowed.push({ ...finding, reason: 'inline style on an aria-hidden element' });
            } else if (target && decorativeSelector.test(target)) {
                allowed.push({ ...finding, reason: `decorative selector ${selector.replace(/\s+/g, ' ')}` });
            } else {
                problems.push({ ...finding, where: selector ? `in ${selector.replace(/\s+/g, ' ')}` : 'inline' });
            }
        }
    }
    return { problems, allowed };
}

const tokens = await readTokens();
let failures = 0;

const rows = pairs.map((pair) => {
    const foreground = tokens.get(pair.fg);
    const background = tokens.get(pair.bg);
    if (!foreground || !background || !hexPattern.test(foreground) || !hexPattern.test(background)) {
        failures += 1;
        return { ...pair, foreground: foreground ?? '?', background: background ?? '?', ratio: 'missing', result: 'FAIL' };
    }
    const ratio = contrastRatio(foreground, background);
    const passes = ratio >= minimums[pair.kind];
    if (!passes) failures += 1;
    return { ...pair, foreground, background, ratio: `${ratio.toFixed(2)}:1`, result: passes ? 'pass' : 'FAIL' };
});

const columns = [
    ['Result', (row) => row.result],
    ['Ratio', (row) => row.ratio],
    ['Needs', (row) => `${minimums[row.kind]}:1 ${row.kind}`],
    ['Foreground', (row) => `${row.fg} ${row.foreground}`],
    ['Background', (row) => `${row.bg} ${row.background}`],
    ['Use', (row) => row.use],
];
const widths = columns.map(([heading, value]) => Math.max(heading.length, ...rows.map((row) => value(row).length)));
const formatRow = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');

console.log('WCAG 2.1 contrast, colors from src/styles/tokens.css\n');
console.log(formatRow(columns.map(([heading]) => heading)));
console.log(formatRow(widths.map((width) => '-'.repeat(width))));
for (const row of rows) console.log(formatRow(columns.map(([, value]) => value(row))));

const { problems: accentProblems, allowed: accentDecorative } = await findAccentColorDeclarations();
console.log(`\nLogo rose (--color-accent, #D48A95) set as \`color\` in src/**/*.astro and *.css:`);
for (const finding of accentDecorative) {
    console.log(`  ok   ${finding.file}:${finding.line}  ${finding.text}  (${finding.reason})`);
}
for (const problem of accentProblems) {
    console.log(`  FAIL ${problem.file}:${problem.line}  ${problem.text} ${problem.where}  (rose text must use --color-accent-text)`);
}
if (accentDecorative.length === 0 && accentProblems.length === 0) console.log('  none');
failures += accentProblems.length;

if (failures > 0) {
    console.log(`\n${failures} problem(s) found.`);
    process.exit(1);
}
console.log(`\nAll ${rows.length} pairs pass, and the logo rose is never used for text.`);
