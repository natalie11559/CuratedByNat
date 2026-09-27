import { fields } from '@keystatic/core';

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
                description: 'JPG, PNG or WebP. Photos straight from your phone are fine; the site resizes them.',
                directory,
                publicPath: `/${directory}/`,
                validation: { isRequired: true },
            }),
            alt: fields.text({
                label: 'Photo description (alt text)',
                description:
                    altDescription ??
                    'Describe what is in the photo in one sentence, for visitors who use screen readers. Required. If you change the photo, update this too.',
                validation: { length: { min: 1, max: 250 } },
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
