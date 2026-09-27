import type { ImageMetadata } from 'astro';

// Keystatic stores each photo as a path like "/src/assets/images/home/hero/image.jpg".
// Globbing the folder lets Astro optimize any photo Nat uploads without a code change.
const imageModules = import.meta.glob<{ default: ImageMetadata }>(
    '/src/assets/images/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP}',
    { eager: true },
);

export function resolveImage(path: string | null | undefined): ImageMetadata | undefined {
    if (!path) {
        return undefined;
    }
    return imageModules[path]?.default;
}

export type FocusVertical = 'top' | 'upper' | 'center' | 'lower' | 'bottom';
export type FocusHorizontal = 'left' | 'center' | 'right';

const verticalPositions: Record<FocusVertical, string> = {
    top: '12%',
    upper: '32%',
    center: '50%',
    lower: '70%',
    bottom: '88%',
};

const horizontalPositions: Record<FocusHorizontal, string> = {
    left: '25%',
    center: '50%',
    right: '75%',
};

/** Turns the editor's "keep in view" choices into a CSS object-position value. */
export function focusToObjectPosition(
    vertical: string | null | undefined,
    horizontal: string | null | undefined,
): string {
    const y = verticalPositions[(vertical as FocusVertical) ?? 'center'] ?? '50%';
    const x = horizontalPositions[(horizontal as FocusHorizontal) ?? 'center'] ?? '50%';
    return `${x} ${y}`;
}
