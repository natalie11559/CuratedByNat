// A bucket held in memory, for tests.
import type { R2Bucket } from '../../../src/lib/cloudflare.ts';

export class FakeR2 implements R2Bucket {
    objects = new Map<string, { data: ArrayBuffer | string; contentType?: string }>();

    async get(key: string) {
        const object = this.objects.get(key);
        if (!object) return null;
        return {
            body: new ReadableStream(),
            etag: 'etag',
            httpMetadata: { contentType: object.contentType },
            text: async () => String(object.data),
        };
    }

    async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }) {
        this.objects.set(key, { data: value, contentType: options?.httpMetadata?.contentType });
    }

    async delete(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
    }

    async list(options?: { prefix?: string }) {
        const prefix = options?.prefix ?? '';
        return { objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    }
}
