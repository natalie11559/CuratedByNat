// Minimal types for the Workers runtime module used by /api/inquiry. The full types are in
// @cloudflare/workers-types, which this project does not install.
declare module 'cloudflare:workers' {
    export const env: Record<string, unknown>;
}
