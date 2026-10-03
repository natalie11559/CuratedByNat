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
| Studio (private) | A private CRM at `/studio` for Nat: leads, pipeline, bookings and payments, contracts, calendar and reply templates. Behind Cloudflare Access. See [Studio](#studio-the-private-crm). |
| Cloudflare R2 + a cron trigger | Every six hours the Worker copies Nat's newest Instagram posts into a bucket; the next build turns them into the Home tiles and the "Inquire now" slideshow. See [Instagram feed](#instagram-feed). |

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
| `INSTAGRAM_ACCESS_TOKEN` | Secret, runtime | `npx wrangler secret put INSTAGRAM_ACCESS_TOKEN`. Only the first token: the refreshed one is kept in D1. Set it again if the connection ever expires. |
| `DEPLOY_HOOK_URL` | Secret, runtime | `npx wrangler secret put DEPLOY_HOOK_URL` (a Workers Builds deploy hook for `main`). |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `STUDIO_ALLOWED_EMAILS` | Secrets, runtime | `npx wrangler secret put ...`. Studio's sign-in settings; see [STUDIO-SETUP.md](STUDIO-SETUP.md). Studio stays closed (404) until all three are set. |
| `STUDIO_DEV_BYPASS`, `STUDIO_DEV_EMAIL` | Local only | `.dev.vars`. Skip the Access sign-in on localhost in development. Ignored in production builds. |
| `INSTAGRAM_FEED_URL` | Build-time, optional | Where the build downloads the feed from. Defaults to the live site in Cloudflare's builds (`WORKERS_CI`); unset locally, so local builds never touch the network. `off` disables it. |

If `RESEND_API_KEY` is missing in production, inquiries are still saved to D1 but no email is sent.

## Instagram feed

Two sections can show Nat's latest Instagram posts instead of hand-picked photos: the four tiles in "More of
my work, over on Instagram" on Home, and the slideshow behind "Inquire now". Nat chooses per section under
Services and photos > Instagram feed (automatic photos); her hand-picked photos stay as the backup.

How it works (all free, no third-party service):

1. `src/worker.ts` is the Worker's entry point. Besides serving the site it has a `scheduled` handler that runs
   `src/lib/instagram/sync.ts` every six hours (cron in `wrangler.jsonc`).
2. The job refreshes the Instagram access token (kept in the D1 table `instagram_state`), lists her recent
   posts through the Instagram API with Instagram Login, and copies new pictures into the R2 bucket
   `curatedbynat-instagram`. Instagram's own picture links expire within days, so the copies are needed.
   It stores a cleaned first sentence of each caption as alt text (never a caption that mentions prices).
3. When the list changed, it calls a Workers Builds deploy hook, so the site rebuilds.
4. `integrations/instagram-feed.mjs` runs at the start of every build in Cloudflare. It downloads the list
   and pictures from `/api/instagram/feed` and `/api/instagram/image/<file>` into git-ignored folders, and
   from there they go through the normal photo pipeline (AVIF/WebP, srcset, lazy loading).
5. If the feed is empty, has fewer than four usable posts, or anything fails, the build quietly uses the
   photos Nat picked. A failure never affects the live site.

If the token cannot refresh, or expires within 10 days, hello@curatedbynat.com gets a plain-language email
(at most one every three days). Inspect the job's last run with:

```bash
npx wrangler d1 execute curatedbynat-inquiries --remote --command "SELECT key, value, updated_at FROM instagram_state WHERE key IN ('last_sync')"
```

### One-time setup

Order matters: create the bucket and run the migration *before* the code that uses them is merged.

1. `npx wrangler r2 bucket create curatedbynat-instagram` (Cloudflare may ask to enable R2; the free tier is far
   above this site's use).
2. `npx wrangler d1 migrations apply curatedbynat-inquiries --remote`
3. Merge to `main` (deploys). The cron starts, finds no token and does nothing.
4. **Nat** creates the connection (she needs to be logged in as the @curated.bynat account, which must be a
   Business or Creator account):
   1. Go to developers.facebook.com, log in with Facebook and register as a developer.
   2. My Apps > Create App. Pick the use case for managing messaging and content on Instagram (Meta
      renames these screens now and then; the goal is an app with the **Instagram API with Instagram Login**).
   3. In the app dashboard open Instagram > API setup with Instagram login > Add account, and log in as
      @curated.bynat.
   4. Click **Generate token** next to the account and copy it. It needs the `instagram_business_basic`
      permission, which is the default. No app review is needed because the app only reads Nat's own account.
5. **Matt** stores the token: `npx wrangler secret put INSTAGRAM_ACCESS_TOKEN` and pastes it.
6. **Matt** creates the deploy hook: Cloudflare > Workers & Pages > curatedbynat > Settings > Builds > Deploy
   Hooks > Add (branch `main`), then `npx wrangler secret put DEPLOY_HOOK_URL` with its URL.
7. The next run (within six hours) fills the bucket and triggers a rebuild. To run it immediately from your
   Mac, put the same values in `.dev.vars` and run `npx wrangler dev --remote --test-scheduled`, then open
   `http://localhost:8787/cdn-cgi/handler/scheduled` (this uses the real D1 and R2).

A new token is only needed if the connection lapses (for example Nat changes her Instagram password or
removes the app). Repeat steps 4.3 to 5.

## Studio (the private CRM)

Studio lives at `https://curatedbynat.com/studio`, in the same Worker, repository and D1 database as the website.
Nat uses it on her phone to track every inquiry through her booking pipeline, record bookings and payments, keep
signed contracts, run her calendar (also shown in her phone's own calendar app) and reply with saved messages.
Her guide is [STUDIO-GUIDE.md](STUDIO-GUIDE.md); Matt's setup steps are in [STUDIO-SETUP.md](STUDIO-SETUP.md).

**What it is made of**

| Piece | Where |
|---|---|
| Pages (server-rendered Astro, no React, no inline script or style) | `src/pages/studio/**`, `src/components/studio/**`, `src/layouts/StudioLayout.astro` |
| Form handlers (all writes are same-origin `POST`s that redirect back with a banner code) | `src/pages/api/studio/**` |
| Logic, with no Cloudflare imports so Node can test it | `src/lib/studio/*.ts` (`queries`, `leads`, `bookings`, `files`, `calendar`, `ics`, `templates`, `clients`, `admin`, `money`, `dates`, `tz`, `validate`, ...) |
| Tables | `migrations/0003` to `0007` (leads, activities, audit_log, settings, packages, extras, bookings, payments, files, calendar_items, templates) |
| Styles and script | `src/studio/studio.css` and `client.js`, served by the guarded routes `/studio/app.css` and `/studio/app.js` |
| Files (contracts) | R2 bucket `curatedbynat-studio-files` (binding `STUDIO_FILES`), private, random keys |
| Phone calendar | `GET /cal/<token>.ics` (`src/pages/cal/[token].ics.ts`) |

**Security, in layers.** Cloudflare Access (one-time email code, two allowed emails) sits in front of
`/studio*` and `/api/studio*`. The Worker then checks the Access token itself on every Studio request
(`src/lib/studio/access.ts`: RS256 signature, issuer, audience, expiry, email allowlist) and answers a plain 404
if anything is wrong, so a mistake in Access can't expose data. Studio responses are `no-store`, `noindex`,
`X-Frame-Options: DENY` and carry a strict Content-Security-Policy with no inline code and no third-party
scripts. Writes check the `Origin` header and validate every field on the server; money is whole cents; every
query is parameterized; uploads are identified by their first bytes and served only through an authenticated
route; deletes are soft with a 30-day Recently deleted view; payments, files, deletions and settings leave an
audit trail. Client details are never written to the logs.

**Nothing from Studio reaches the public site.** Every Studio page sets `prerender = false`, and `npm run build`
ends with `scripts/check-build-privacy.mjs`, which fails the build if Studio's routes, class names or setting
names appear in the files Cloudflare serves publicly (`dist/client`). It also warns if a public page looks like it
shows a price. The sitemap and `robots.txt` exclude Studio.

**Prices are not in this repository.** The migrations hold no package prices. Nat's price lists load from a
private, git-ignored file with `npm run studio:seed -- --local` (or `--remote`); see `studio-seed.example.json`.
The calendar feed's secret is generated in the database and can be replaced from Studio's Settings.

**Local development.** `.dev.vars` needs `STUDIO_DEV_BYPASS=1` (copied from `.dev.vars.example`). It works only
for a development build, on localhost, with that flag; a production build ignores it (a Playwright project proves
it). Then `npm run dev` and open http://localhost:4321/studio. `npm run dev:cms` (the local editor mode) leaves
Studio closed.

**Tests.** `npm run test:unit` runs the real migrations on Node's built-in SQLite, so SQL, the partial unique
index and transactions are tested as they are in production. `npm run test:e2e` drives the pages (phone width,
touch-target size, axe accessibility, and every form) and starts a production build to prove Studio is closed
without a sign-in.

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
