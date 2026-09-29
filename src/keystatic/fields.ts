import { fields } from '@keystatic/core';

/**
 * Keystatic's Save does nothing, with no message, while a required box inside a list item is empty.
 * List item labels therefore show what still needs filling in, so Nat can find it.
 */
export const EMPTY_ITEM_LABEL = '⚠ Empty: type something here or remove this item';

export function textItemLabel(value: string): string {
    return value.trim() ? value : EMPTY_ITEM_LABEL;
}

/** Returns a warning for a photo slot that is missing its file or its description, otherwise null. */
export function photoSlotWarning(photo: { fields: { image: { value: unknown }; alt?: { value: string } } }): string | null {
    if (!photo.fields.image.value) return '⚠ Needs a photo';
    if (photo.fields.alt && !photo.fields.alt.value.trim()) return '⚠ Needs a photo description';
    return null;
}

/**
 * Every photo slot in the editor: the file, its alt text, and where to keep the crop focused.
 * `folder` must be unique per singleton. Keystatic renames and cleans up files inside a
 * singleton's folder on save, so two singletons sharing a folder could delete each other's photos.
 */
export function photoField({
    label,
    folder,
    description,
    altDescription,
    defaultVertical = 'center',
    defaultHorizontal = 'center',
}: {
    label: string;
    folder: string;
    description?: string;
    altDescription?: string;
    defaultVertical?: 'top' | 'upper' | 'center' | 'lower' | 'bottom';
    defaultHorizontal?: 'left' | 'center' | 'right';
}) {
    const directory = `src/assets/images/${folder}`;
    return fields.object(
        {
            image: fields.image({
                label: 'Photo',
                description:
                    'Use a JPG or PNG (WebP also works). Photos from your phone are fine; the site resizes them. HEIC photos from a Mac or iPhone must be exported as JPEG first, or the site cannot show them.',
                directory,
                publicPath: `/${directory}/`,
                validation: { isRequired: true },
            }),
            alt: fields.text({
                label: 'Photo description (alt text)',
                description:
                    altDescription ??
                    'Describe what is in the photo in one sentence, for visitors who use screen readers. Required. If you change the photo, update this too.',
                validation: {
                    length: { min: 1, max: 250 },
                    pattern: { regex: /\S/, message: 'Describe the photo in words.' },
                },
            }),
            focusVertical: fields.select({
                label: 'Keep in view (up and down)',
                description: 'If the photo gets cropped, which part must stay visible?',
                options: [
                    { label: 'Top', value: 'top' },
                    { label: 'Upper third (faces)', value: 'upper' },
                    { label: 'Middle', value: 'center' },
                    { label: 'Lower third', value: 'lower' },
                    { label: 'Bottom', value: 'bottom' },
                ],
                defaultValue: defaultVertical,
            }),
            focusHorizontal: fields.select({
                label: 'Keep in view (left and right)',
                options: [
                    { label: 'Left', value: 'left' },
                    { label: 'Center', value: 'center' },
                    { label: 'Right', value: 'right' },
                ],
                defaultValue: defaultHorizontal,
            }),
        },
        { label, description },
    );
}

/** Photo slot for decorative backgrounds, where screen readers skip the image (alt=""). */
export function decorativePhotoField({ label, folder, description }: { label: string; folder: string; description?: string }) {
    const directory = `src/assets/images/${folder}`;
    return fields.object(
        {
            image: fields.image({
                label: 'Photo',
                description:
                    'Use a JPG or PNG (WebP also works). HEIC photos from a Mac or iPhone must be exported as JPEG first, or the site cannot show them.',
                directory,
                publicPath: `/${directory}/`,
                validation: { isRequired: true },
            }),
        },
        { label, description },
    );
}

/** Standard page SEO fields. */
export function seoFields() {
    return fields.object(
        {
            title: fields.text({
                label: 'Page title (shows in Google and the browser tab)',
                description: 'Keep it under 60 characters.',
                validation: { length: { min: 1, max: 70 } },
            }),
            description: fields.text({
                label: 'Page description (shows under the title in Google)',
                description: 'Keep it under 155 characters.',
                multiline: true,
                validation: { length: { min: 1, max: 170 } },
            }),
        },
        { label: 'Search and sharing' },
    );
}
