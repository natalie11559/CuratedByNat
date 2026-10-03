// Works out what a file really is by reading its first bytes, whatever the browser or the file name claims.
// Studio accepts PDFs and pictures only.

export interface FileType {
    contentType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic';
    extension: 'pdf' | 'jpg' | 'png' | 'heic';
    /** Browsers can show these on the page; others are offered as a download. */
    inline: boolean;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

export function sniffFileType(bytes: Uint8Array): FileType | null {
    if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return { contentType: 'application/pdf', extension: 'pdf', inline: true };
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg', inline: true };
    if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
        return { contentType: 'image/png', extension: 'png', inline: true };
    }
    if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12))) {
        return { contentType: 'image/heic', extension: 'heic', inline: false };
    }
    return null;
}

/** A name that is safe to keep and show: no folders, no control characters, not too long. */
export function cleanFileName(name: string, fallbackExtension: string): string {
    const base = name
        .split(/[\\/]/)
        .pop()!
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return base && base !== '.' && base !== '..' ? base : `file.${fallbackExtension}`;
}

/** A Content-Disposition header value that keeps non-English letters and cannot be broken out of. */
export function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\;]/g, '_');
    const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
