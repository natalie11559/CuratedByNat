// The small slice of Cloudflare's D1 and R2 APIs this site uses, so the logic that talks to them can be
// unit tested with plain fakes and does not need `cloudflare:workers`.

export interface D1Statement {
    bind(...values: unknown[]): D1Statement;
    run(): Promise<unknown>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1Database {
    prepare(query: string): D1Statement;
    batch(statements: D1Statement[]): Promise<unknown[]>;
}

export interface R2ObjectBody {
    body: ReadableStream;
    etag: string;
    httpMetadata?: { contentType?: string };
    text(): Promise<string>;
}

export interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: { prefix?: string; cursor?: string }): Promise<{
        objects: { key: string }[];
        truncated: boolean;
        cursor?: string;
    }>;
}
