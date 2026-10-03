// Lets Nat add Studio to her phone's home screen. Scoped to /studio, and it caches nothing: client data is never
// kept on the phone for offline use.
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () =>
    new Response(
        JSON.stringify({
            name: 'Curated by Nat Studio',
            short_name: 'Studio',
            description: 'Leads, bookings and the calendar for Curated by Nat.',
            start_url: '/studio',
            scope: '/studio/',
            display: 'standalone',
            orientation: 'portrait',
            background_color: '#F8F4EE',
            theme_color: '#F8F4EE',
            icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            ],
        }),
        { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
    );
