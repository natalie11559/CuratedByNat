/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        /** Set by src/middleware.ts on Studio requests that passed the sign-in check. */
        studioUser?: { email: string; via: 'access' | 'dev-bypass' };
    }
}
