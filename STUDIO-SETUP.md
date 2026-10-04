# Studio setup (for Matt)

Steps to turn Studio on at `https://curatedbynat.com/studio`, and what to do if something goes wrong. Nat's own
guide is [STUDIO-GUIDE.md](STUDIO-GUIDE.md). The architecture is in the README, under "Studio (the private CRM)".

**Studio is safe to deploy before it is switched on.** Until the three sign-in settings in step 6 exist, every
`/studio` and `/api/studio` request answers an empty 404, whatever Cloudflare Access does. So the order below is
about avoiding errors, not about exposure.

Nothing here costs money at this size. Cloudflare may ask for a card on file when you first enable R2 or Zero Trust;
both stay at $0 for Nat's volume (Zero Trust free plan: up to 50 people; R2 free tier: 10 GB).

Run the commands from the `curatedbynat-site` folder, signed in to Cloudflare with `npx wrangler login`.

## Before you start

- [ ] **Make the GitHub repository private** (recommended). It is `natalie11559/CuratedByNat` and Nat owns it, so
      she does this: GitHub, the repository, Settings, General, scroll to the bottom, **Change visibility**,
      **Make private**. Why: the code is public today, and although no prices or client data are in it, Studio's
      internals and the email allowlist's *shape* are better kept private.
      Afterwards, check that nothing broke: make a small edit in the Keystatic editor (curatedbynat.com/keystatic),
      save, and confirm a new deployment appears in Cloudflare (Workers & Pages, curatedbynat, Deployments). If
      either one can't see the repository, re-grant it access in GitHub (Settings, Applications, the Keystatic and
      Cloudflare apps, **Repository access**).
- [ ] Merge order: the Studio branch (`feature/studio`) was created from the Instagram branch
      (`feature/instagram-feed`), so merging `feature/studio` into `main` brings both. Nothing has been pushed or
      deployed yet. Every push to `main` deploys to production within about three minutes.

## 1. Create the two storage buckets

```bash
npx wrangler r2 bucket create curatedbynat-studio-files
npx wrangler r2 bucket create curatedbynat-instagram
```

Do this **before** merging. The deploy fails if a bucket named in `wrangler.jsonc` does not exist. Neither bucket
has a public address; Studio serves files only through its signed-in routes.

## 2. Apply the database changes

```bash
npx wrangler d1 migrations apply curatedbynat-inquiries --remote
```

It lists migrations 0002 to 0007 (Instagram state, leads, bookings, files, calendar, templates). Say yes. Also
do this **before** merging. (If code goes live first, the website and its inquiry form still work, because the new
steps fail softly, but Studio's pages would error until the tables exist.)

## 3. Load Nat's packages and extras (optional)

Her price lists live in a private file on this Mac, `studio-seed.local.json` (git-ignored; shape in
`studio-seed.example.json`). To put them into the live database:

```bash
npm run studio:seed -- --remote
```

It adds only what is missing, matched by name, and never changes a price that exists. Or skip this and let Nat type
her packages in Studio under Settings. Either way no prices ever enter the repository.

## 4. Create the Zero Trust team (once)

1. In the Cloudflare dashboard, open **Zero Trust** in the left menu.
2. If it asks for a **team name**, use `curatedbynat`. Your team domain is then
   `curatedbynat.cloudflareaccess.com`. Choose the **Free** plan.
3. **Settings, Authentication, Login methods**: make sure **One-time PIN** is listed. If not, **Add new**, choose
   **One-time PIN**, save. (This is the email-code sign-in. No passwords are stored anywhere.)

## 5. Protect Studio with Access

1. **Zero Trust, Access controls, Applications, Add an application, Self-hosted** (the menu names move around a
   little between dashboard versions).
2. **Application name:** `Curated by Nat Studio`. **Session duration:** `1 month` (so Nat is not asked for a new
   code every day on her phone).
3. **Public hostname / destinations:** add two, both on domain `curatedbynat.com`:
   - path `studio*`
   - path `api/studio*`
4. **Policy:** name it `Nat and Matt`, action **Allow**. Under **Include**, choose **Emails** and enter exactly:
   `hello@curatedbynat.com` and `matt.truj7@gmail.com`. Under login methods allow **One-time PIN** only.
5. Save. Open the application again and copy its **Application Audience (AUD) Tag**: a long string of letters and
   numbers. You need it in step 6.

You do **not** need a separate "bypass" for the calendar feed. It lives at `/cal/...`, which Access does not cover.

## 6. Tell the Worker who may in

These are secrets so the email addresses and settings stay out of the repository:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN     # curatedbynat.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD             # the AUD tag from step 5
npx wrangler secret put STUDIO_ALLOWED_EMAILS  # hello@curatedbynat.com,matt.truj7@gmail.com
```

Each command asks for the value. Use the same two addresses as in the Access policy. The Worker checks both: Access
is the front door, and this is the second lock.

## 7. Deploy

Merge `feature/studio` into `main` (or open a pull request). Cloudflare builds and deploys in about three minutes.
The build runs `scripts/check-build-privacy.mjs` and fails if anything from Studio would be published; if a deploy
fails with `[privacy] Studio-only text is in the public build`, read the lines it lists.

## 8. Test it

1. On a phone or in a private window, go to `https://curatedbynat.com/studio`. You should see Cloudflare's
   sign-in page, not Studio.
2. Enter `hello@curatedbynat.com`. Nat receives a 6-digit code (check spam the first time). After entering it she
   should land on Studio's Home screen ("Hi, Nat.").
3. Try an address that is not on the list. Cloudflare should refuse it.
4. Open `https://curatedbynat.com/api/studio/session` while signed in: it shows the signed-in email.
5. Confirm the public site is unaffected: `https://curatedbynat.com/robots.txt` lists `/studio` as disallowed, and
   `https://curatedbynat.com/sitemap-index.xml` doesn't mention it.

## 9. Phone setup (with Nat)

- **Home screen:** in Safari on her iPhone, open Studio, tap Share, **Add to Home Screen**. The first sign-in after
  that may open in a small Safari sheet and then return; that is Cloudflare's login page, which sits outside the
  app. With a one-month session it is rare.
- **Calendar:** Studio, Settings, **Calendar on your phone**, **Add to iPhone Calendar**. The link is private; it
  shows first names, the kind of item, the time and the city, nothing else.

## If something goes wrong

**Studio shows a blank "Not found" for Nat or you, even after signing in.** That is Studio's second lock saying no.
Look at the log line it leaves: Cloudflare dashboard, Workers & Pages, curatedbynat, **Logs** (or
`npx wrangler tail` in a terminal), and look for `[studio] Refused a request: <reason>`:

| Reason | Meaning and fix |
|---|---|
| `not-configured` | One of the three secrets in step 6 is missing or has a typo (the team domain must end in `.cloudflareaccess.com`). Set it again. |
| `wrong-audience` | `ACCESS_AUD` is not the AUD tag of this Access application (for example the application was recreated). Copy it again. |
| `wrong-issuer` | `ACCESS_TEAM_DOMAIN` doesn't match your team. |
| `email-not-allowed` | Signed in with an address that isn't in `STUDIO_ALLOWED_EMAILS`. Use the right one, or add it (and to the Access policy). |
| `expired`, `not-yet-valid` | The phone's clock is wrong, or the sign-in is old. Sign out and in again. |
| `unknown-key`, `bad-signature`, `bad-algorithm`, `malformed`, `error` | The token isn't from your Access team. Usually Access isn't in front of the address being used (for example a `workers.dev` address). Use `https://curatedbynat.com/studio`. |

**Nat can't get the code.** Check spam, and that she typed `hello@curatedbynat.com` exactly. Codes expire after a
few minutes; ask for a new one. To let her in with another address, add it to the Access policy (step 5) **and** to
`STUDIO_ALLOWED_EMAILS` (step 6).

**You are locked out too.** Whoever owns the Cloudflare account can edit the Access policy (Zero Trust, Access
controls, Applications) and re-run `wrangler secret put STUDIO_ALLOWED_EMAILS`.

**A page says "Error 1102" or "exceeded resource limits".** The Workers free plan has a small per-request CPU
allowance. Studio is light, but if this ever shows up on a busy page, the Workers Paid plan ($5 a month) removes it.
Nothing is lost; reload to try again.

**The calendar link was shared by mistake.** Studio, Settings, **Calendar on your phone**, **Make a new link**. The
old link stops working at once. Add the new one to the phone the same way.

**Move or back up the data.** Everything is in the D1 database `curatedbynat-inquiries` and the R2 bucket
`curatedbynat-studio-files`. For example:

```bash
npx wrangler d1 export curatedbynat-inquiries --remote --output studio-backup.sql
```

## Instagram feed

Its own one-time setup (a Meta developer app, a token, a rebuild link) is in the README, under "Instagram feed".
If the connection ever needs attention, Studio's Home screen shows "Instagram needs a quick look" and the job emails
hello@ in plain words.
