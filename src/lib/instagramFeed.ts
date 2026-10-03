// The Instagram posts downloaded at build time (integrations/instagram-feed.mjs), shaped for the pages.
// Each function returns an empty list when the feed is off, empty, or too short to fill the section,
// and the page then uses the photos Nat picked in the editor.
import { instagramFeedSettings } from './content';
import { EMPTY_MANIFEST, selectPosts, type FeedManifest } from './instagram/feed';

const manifests = import.meta.glob<FeedManifest>('/src/generated/instagram-feed.json', { eager: true, import: 'default' });
const manifest: FeedManifest = Object.values(manifests)[0] ?? EMPTY_MANIFEST;

export interface FeedPhoto {
    /** Path in the form `resolveImage` and the Photo component expect. */
    image: string;
    alt: string;
    /** The post on Instagram. */
    href: string;
}

function photos(count: number, minimum: number): FeedPhoto[] {
    return selectPosts(manifest.posts, {
        count,
        minimum,
        includeVideoCovers: instagramFeedSettings.includeVideoCovers,
        hiddenLinks: instagramFeedSettings.hiddenPosts,
    }).map((post) => ({ image: `/src/assets/images/instagram-feed/${post.key}`, alt: post.alt, href: post.permalink }));
}

/** Exactly four photos for the Home section, or none. */
export function homeFeedPhotos(): FeedPhoto[] {
    return instagramFeedSettings.homeSource === 'latest' ? photos(4, 4) : [];
}

/** Between four and the chosen number of photos for the closing slideshow, or none. */
export function slideshowFeedPhotos(): FeedPhoto[] {
    return instagramFeedSettings.slideshowSource === 'latest' ? photos(instagramFeedSettings.slideshowCount, 4) : [];
}
