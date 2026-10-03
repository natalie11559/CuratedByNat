// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    FALLBACK_ALT,
    altTextFromCaption,
    daysUntilExpiry,
    extensionForContentType,
    manifestFingerprint,
    pictureUrl,
    selectPosts,
    shortcodeFromPermalink,
    toFeedPost,
    tokenIsExpiringSoon,
    tokenNeedsRefresh,
    type FeedPost,
    type RawMedia,
} from '../../src/lib/instagram/feed.ts';

function post(id: string, timestamp: string, overrides: Partial<FeedPost> = {}): FeedPost {
    return {
        id,
        key: `${id}.jpg`,
        permalink: `https://www.instagram.com/p/code${id}/`,
        timestamp,
        isVideoCover: false,
        alt: 'A bride laughing on a porch',
        ...overrides,
    };
}

describe('altTextFromCaption', () => {
    it('keeps the first sentence and drops hashtags, mentions, links and emoji', () => {
        const caption = 'Emory + Cole at The Barn ✨ What a day! #georgiawedding @thebarn https://example.com';
        assert.equal(altTextFromCaption(caption), 'Emory + Cole at The Barn');
    });

    it('falls back when the caption is empty or only tags', () => {
        assert.equal(altTextFromCaption(undefined), FALLBACK_ALT);
        assert.equal(altTextFromCaption('#wedding #georgia'), FALLBACK_ALT);
        assert.equal(altTextFromCaption('🤍'), FALLBACK_ALT);
    });

    it('never uses a caption that talks about prices', () => {
        assert.equal(altTextFromCaption('Packages start at $300 for a full day'), FALLBACK_ALT);
        assert.equal(altTextFromCaption('Our pricing is open now!'), FALLBACK_ALT);
        assert.equal(altTextFromCaption('Book now for 2027 weddings'), FALLBACK_ALT);
    });

    it('shortens long sentences at a word boundary', () => {
        const alt = altTextFromCaption(`${'Lovely golden hour portraits on the lawn '.repeat(5)}`);
        assert.ok(alt.length <= 112, alt);
        assert.ok(alt.endsWith('…'));
    });
});

describe('pictureUrl and extensionForContentType', () => {
    const base = { id: '1', permalink: 'https://www.instagram.com/p/a/', timestamp: '2026-01-01T00:00:00+0000' };

    it('uses the cover frame for videos and the picture for photos', () => {
        const video: RawMedia = { ...base, media_type: 'VIDEO', media_url: 'https://cdn/video.mp4', thumbnail_url: 'https://cdn/cover.jpg' };
        const image: RawMedia = { ...base, media_type: 'IMAGE', media_url: 'https://cdn/photo.jpg' };
        assert.equal(pictureUrl(video), 'https://cdn/cover.jpg');
        assert.equal(pictureUrl(image), 'https://cdn/photo.jpg');
    });

    it('ignores links that are not https', () => {
        assert.equal(pictureUrl({ ...base, media_type: 'IMAGE', media_url: 'http://cdn/photo.jpg' }), null);
        assert.equal(pictureUrl({ ...base, media_type: 'VIDEO' }), null);
    });

    it('only accepts picture types the site can process', () => {
        assert.equal(extensionForContentType('image/jpeg'), 'jpg');
        assert.equal(extensionForContentType('image/webp; charset=binary'), 'webp');
        assert.equal(extensionForContentType('video/mp4'), null);
        assert.equal(extensionForContentType('image/heic'), null);
        assert.equal(extensionForContentType(null), null);
    });

    it('marks video posts as covers', () => {
        const video: RawMedia = { ...base, media_type: 'VIDEO', thumbnail_url: 'https://cdn/c.jpg', caption: 'Reel day' };
        assert.equal(toFeedPost(video, 'jpg').isVideoCover, true);
        assert.equal(toFeedPost({ ...video, media_type: 'IMAGE' }, 'jpg').key, '1.jpg');
    });
});

describe('shortcodeFromPermalink', () => {
    it('reads posts, reels and tv links', () => {
        assert.equal(shortcodeFromPermalink('https://www.instagram.com/p/Cx12_ab-9/'), 'Cx12_ab-9');
        assert.equal(shortcodeFromPermalink('https://www.instagram.com/reel/Abc123/?igsh=xyz'), 'Abc123');
        assert.equal(shortcodeFromPermalink('https://www.instagram.com/curated.bynat/p/Zzz/'), 'Zzz');
        assert.equal(shortcodeFromPermalink('https://example.com/'), null);
    });
});

describe('selectPosts', () => {
    const posts = [
        post('1', '2026-01-01T00:00:00+0000'),
        post('2', '2026-03-01T00:00:00+0000', { isVideoCover: true }),
        post('3', '2026-02-01T00:00:00+0000'),
        post('4', '2026-04-01T00:00:00+0000'),
        post('5', '2025-12-01T00:00:00+0000'),
    ];

    it('returns the newest posts first', () => {
        const chosen = selectPosts(posts, { count: 3, includeVideoCovers: true, hiddenLinks: [] });
        assert.deepEqual(chosen.map((item) => item.id), ['4', '2', '3']);
    });

    it('can leave out video covers', () => {
        const chosen = selectPosts(posts, { count: 3, includeVideoCovers: false, hiddenLinks: [] });
        assert.deepEqual(chosen.map((item) => item.id), ['4', '3', '1']);
    });

    it('hides posts whose link Nat pasted, even with extra tracking in the link', () => {
        const chosen = selectPosts(posts, {
            count: 3,
            includeVideoCovers: true,
            hiddenLinks: ['https://www.instagram.com/p/code4/?utm_source=ig_web_copy_link'],
        });
        assert.deepEqual(chosen.map((item) => item.id), ['2', '3', '1']);
    });

    it('returns nothing when there are not enough posts to fill the section', () => {
        assert.deepEqual(selectPosts(posts, { count: 6, includeVideoCovers: true, hiddenLinks: [] }), []);
        assert.equal(selectPosts(posts, { count: 8, minimum: 4, includeVideoCovers: true, hiddenLinks: [] }).length, 5);
    });
});

describe('manifestFingerprint', () => {
    it('changes when a post, link or description changes, not when only the sync time does', () => {
        const a = [post('1', '2026-01-01T00:00:00+0000')];
        assert.equal(manifestFingerprint(a), manifestFingerprint([{ ...a[0]! }]));
        assert.notEqual(manifestFingerprint(a), manifestFingerprint([{ ...a[0]!, alt: 'Different' }]));
        assert.notEqual(manifestFingerprint(a), manifestFingerprint([]));
    });
});

describe('access token timing', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const days = (count: number) => new Date(now.getTime() - count * 86_400_000).toISOString();
    const inDays = (count: number) => new Date(now.getTime() + count * 86_400_000).toISOString();

    it('refreshes a seed token straight away and a saved one weekly', () => {
        assert.equal(tokenNeedsRefresh({ token: 't', refreshedAt: null, expiresAt: null }, now), true);
        assert.equal(tokenNeedsRefresh({ token: 't', refreshedAt: days(3), expiresAt: inDays(57) }, now), false);
        assert.equal(tokenNeedsRefresh({ token: 't', refreshedAt: days(7), expiresAt: inDays(53) }, now), true);
    });

    it('warns ten days before the token runs out', () => {
        assert.equal(tokenIsExpiringSoon({ token: 't', refreshedAt: days(50), expiresAt: inDays(10) }, now), false);
        assert.equal(tokenIsExpiringSoon({ token: 't', refreshedAt: days(51), expiresAt: inDays(9) }, now), true);
        assert.equal(tokenIsExpiringSoon({ token: 't', refreshedAt: null, expiresAt: null }, now), false);
        assert.equal(daysUntilExpiry({ token: 't', refreshedAt: null, expiresAt: inDays(5) }, now), 5);
    });
});
