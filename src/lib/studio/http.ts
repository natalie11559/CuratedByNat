// Small helpers for Studio's API routes.

/**
 * Writes must come from Studio's own pages. Browsers always send an Origin header on a POST, PATCH or DELETE,
 * so a missing or different one means the request came from somewhere else.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
    const origin = request.headers.get('origin');
    return origin !== null && origin === url.origin;
}

export function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const forbidden = (): Response => json(403, { ok: false, error: 'That request did not come from Studio.' });
