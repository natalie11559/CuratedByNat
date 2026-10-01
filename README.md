# Curated by Nat website

Marketing site for Curated by Nat, a wedding and event content creator based in Georgia. Four pages
(Home, About, Services, Inquire) plus a 404 page and an inquiry success page. The site's one job is to
get visitors to send an inquiry.

Nat edits everything in the browser at `/keystatic`. Her guide is [EDITING-GUIDE.md](EDITING-GUIDE.md).

## How it fits together

| Piece | What it does |
|---|---|
| [Astro 7](https://astro.build) | Builds every page to static HTML at deploy time. Photos are resized to AVIF and WebP with `srcset`. |
| [Keystatic](https://keystatic.com) + Keystatic Cloud | The editor at `/keystatic`. Nat signs in with her email and password; each save commits the changed JSON and photos to GitHub. |
| Cloudflare Workers | Hosts the static pages (free, unlimited static requests) and runs two small server routes: the editor shell and `POST /api/inquiry`. |
| Cloudflare Workers Builds | Rebuilds and deploys on every push to `main`, including Nat's saves. A change is live in about 2 to 3 minutes. |
| Cloudflare D1 | Stores every inquiry as a backup, before the email is sent. |
| Cloudflare Turnstile | Invisible spam check on the form, together with a honeypot field and a minimum fill time. |
| [Resend](https://resend.com) | Emails each inquiry to hello@curatedbynat.com with Reply-To set to the visitor. |

Content lives in `src/content/*.json` (one file per editor section) and photos in
`src/assets/images/<section>/`. Each editor section has its own photo folder, because Keystatic renames
and cleans up the files in a section's folder when it saves.

A build step (`integrations/prune-unreferenced-images.mjs`) deletes any original photo that no page
references, so full-size uploads, which can carry phone GPS data, are never published. Only the resized
copies ship, and those carry no metadata.

A photo the build cannot process (for example a HEIC upload) or one without alt text is left out of the
page with a `[photo] Left out of the page` warning in the build log, rather than failing the build, so
it can't block Nat's other edits. `npm run dev` still stops with an error for the same problem.

## Local development

Requirements: Node 22.12 or newer (`.node-version` pins 22.19 for Cloudflare builds).

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply curatedbynat-inquiries --local
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | The site on Cloudflare's local runtime, with a local D1 database and Turnstile test keys. Inquiries are saved locally and the email is printed to the terminal instead of sent. |
| `npm run dev:cms` | The editor in local-file mode at http://127.0.0.1:4321/keystatic (runs on Node, because local mode writes files). On macOS's default case-insensitive disk, don't reorder photos in this mode: Keystatic's local storage can delete a renamed photo. Nat's editor (Keystatic Cloud) is not affected. |
| `npm run build` | Production build. Needs `PUBLIC_TURNSTILE_SITE_KEY`; for a local test build use `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build`. |
| `npm run preview` | Builds, then serves the production output with `wrangler dev`. |
| `npm run test:unit` | Validation and email unit tests. |
| `npm run test:e2e` | Playwright tests (form, pages, accessibility). Run `npx playwright install chromium` once first. |
| `npm run check:contrast` | Checks every text color pair against WCAG AA. |
| `node scripts/generate-brand-assets.mjs` | Regenerates the favicons, app icons and `og-image.jpg` from the logo. |

## Settings and secrets

Nothing secret is committed. `.dev.vars` and `.env` are git-ignored.

| Name | Kind | Where it is set |
|---|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | Public, build time | Cloudflare > Workers > curatedbynat > Settings > Build > Variables |
| `PUBLIC_KEYSTATIC_CLOUD_PROJECT` | Public, build time, optional | Overrides the project in `keystatic.config.ts` (`curated-by-nat/curatedbynat`). |
| `TURNSTILE_SECRET_KEY` | Secret, runtime | `npx wrangler secret put TURNSTILE_SECRET_KEY` |
| `RESEND_API_KEY` | Secret, runtime | `npx wrangler secret put RESEND_API_KEY` |
| `INQUIRY_TO`, `INQUIRY_FROM` | Plain vars | `wrangler.jsonc` |

If `RESEND_API_KEY` is missing in production, inquiries are still saved to D1 but no email is sent.

## Reading the inquiry backup

```bash
npx wrangler d1 execute curatedbynat-inquiries --remote --command "SELECT created_at, first_name, last_name, email, celebrating, event_date, email_status FROM inquiries ORDER BY created_at DESC LIMIT 20"
```

The same table is browsable in the Cloudflare dashboard under Storage & Databases > D1.

## How it deploys now

Cloudflare Workers Builds is connected to `natalie11559/CuratedByNat`. Every push to `main`, including
each save Nat makes in Keystatic, runs `npm run build` and `npx wrangler deploy` (build variable
`PUBLIC_TURNSTILE_SITE_KEY`). The site is live at https://curatedbynat.com. Build logs are under
Workers & Pages > curatedbynat > Deployments.

## Deploying (first time)

Do these while signed in to the Curated by Nat accounts.

1. **GitHub.** Push this repository to a private GitHub repo.
2. **Cloudflare CLI login.** Run `npx wrangler login` and approve access in the browser.
3. **Database.** Run `npx wrangler d1 create curatedbynat-inquiries`, put the printed `database_id` into
   `wrangler.jsonc`, commit, then run `npx wrangler d1 migrations apply curatedbynat-inquiries --remote`.
4. **Turnstile.** In the Cloudflare dashboard go to Turnstile > Add widget. Use Managed mode, and add the
   hostnames `curatedbynat.com`, `www.curatedbynat.com` and the `*.workers.dev` preview host. Keep the
   site key and secret key for the next steps.
5. **Keystatic Cloud.** Create a project, connect it to the GitHub repo (this installs the Keystatic GitHub
   App), and note the `team-slug/project-slug`.
6. **Workers Builds.** In Workers & Pages > Create > Import a repository, pick the repo. Set the build
   command to `npm run build` and the deploy command to `npx wrangler deploy`. Add the build variables
   `PUBLIC_TURNSTILE_SITE_KEY` and `PUBLIC_KEYSTATIC_CLOUD_PROJECT`. The Worker name must be `curatedbynat`,
   matching `wrangler.jsonc`.
7. **Secrets.** After the first deploy, run `npx wrangler secret put TURNSTILE_SECRET_KEY` and
   `npx wrangler secret put RESEND_API_KEY`. Wrangler prompts for each value; nothing is echoed or saved locally.
8. **Resend.** Add the domain `curatedbynat.com` and create a sending-only API key for step 7. Resend
   shows the DNS records it needs.
9. **Domain.** Point `curatedbynat.com` and `www.curatedbynat.com` at the Worker (Workers > curatedbynat >
   Settings > Domains & Routes > Add custom domain), and redirect `www` to the bare domain. This needs the
   domain's DNS on Cloudflare; the exact records are in the launch notes.
10. **Check.** Send a real inquiry from the live site and confirm it arrives at hello@curatedbynat.com and
    appears in D1 with `email_status = 'sent'`.
