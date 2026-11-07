# Blockers

## Waiting for the user

### Update the live secrets (live project was recreated)

The live project is now `qqobvcelbzhrcehqukrs` (Frankfurt). At https://github.com/TCannonx/airhead/settings/secrets/actions, update `SUPABASE_PROJECT_REF_LIVE` to `qqobvcelbzhrcehqukrs` and `SUPABASE_DB_PASSWORD_LIVE` to the new live database password. Until then, the live keep-alive and backup jobs fail (dev is unaffected).

### Phase 4 ready for device testing and release

Phase 4 (calendar, sharing, work and leave, import, notifications) is merged and deploys to dev. For the AI import and notifications, dev needs items 8 (Vault secrets), 9 (Anthropic key) and 10 (VAPID keys). Then run the Phase 4 section of `docs/MANUAL-CHECKLIST.md`, then the v0.1 acceptance list in `docs/PLAN.md`. Releasing to live (a `v0.1.0` tag) is still yours; live needs items 7–10 too.

### Phase 3 ready for device testing and release

Phase 3 (AI sorting, link reading, lists, memory) is merged and deploys to dev. AI features need items 8 (Vault secrets) and 9 (Anthropic API key) in the dev project; without them captures still save and free rules still work. Then run the Phase 3 section of `docs/MANUAL-CHECKLIST.md`. Releasing to live is still your tag (live needs items 7–9 as well).

### Phase 2 ready for device testing and release

Phase 2 (capture core and sync) is merged and deploys to dev on every merge. Run the Phase 1 and 2 sections of `docs/MANUAL-CHECKLIST.md` once Cloudflare Pages (item 5) is connected, so the app has a web address for your devices. Releasing to live is still your tag.

### Phase 1 ready for device testing and release

Phase 1 is merged. Once items 1–5 below are done, run the Phase 1 section of `docs/MANUAL-CHECKLIST.md` on iPhone, iPad and desktop Chrome. Release to live by tagging (`v0.0.1`, say) once item 7 is done, or tell Claude Code to tag it. Releases are never made without you.

### 1. Create the Supabase projects (needed from Task 1.4 on)

1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is fine).
2. **New project** → organisation: your personal one → name `airhead-dev` → set a strong database password and keep it in your password manager → region **West EU (Ireland)** → plan **Free** → **Create new project**.
3. Repeat for `airhead-live`.
4. For each project, open **Project Settings → General** and note the **Project ID** (the "ref", about 20 letters).
5. Create a personal access token: avatar (top right) → **Account preferences → Access Tokens** → **Generate new token** → name `airhead-ci`. Copy it once; it is shown only once.
6. In this terminal, link the dev project yourself so no secret passes through chat:
   - `! npx supabase login` (paste the token when asked)
   - `! npx supabase link --project-ref <airhead-dev ref>` (enter the dev database password when asked)
7. Create `.env.local` in the repo root (git-ignored) using `.env.example`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from the dev project's **Project Settings → API** (the publishable/anon key, not the service key); `SUPABASE_PROJECT_REF_DEV` is the dev ref.
8. Tell Claude Code "Supabase projects are created". GitHub secrets for the deploy workflows are listed in Task 1.8.

**Database password:** keep it in your password manager. You type it at the `supabase link` prompt; Claude Code never needs it. Optionally put `SUPABASE_DB_PASSWORD=` in `.env.local` (git-ignored; Claude Code is blocked from reading `.env*` files) so local commands against dev don't prompt.

### 2. GitHub Actions secrets (needed for Task 1.8 workflows; fine to add now)

`gh` isn't installed, so add them in the browser: https://github.com/TCannonx/airhead/settings/secrets/actions → **New repository secret**, one each:

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the personal access token from step 1.5 |
| `SUPABASE_PROJECT_REF_DEV` | dev project ref |
| `SUPABASE_PROJECT_REF_LIVE` | live project ref |
| `SUPABASE_DB_PASSWORD_DEV` | dev database password |
| `SUPABASE_DB_PASSWORD_LIVE` | live database password |

### 3. Email sign-in code (Task 1.5)

In **each** Supabase project: **Authentication → Emails → Templates**. Paste `supabase/templates/magic_link.html` into **Magic Link** and `supabase/templates/confirmation.html` into **Confirm signup** (first sign-in for a new email uses that one). Both include the code, e.g.:

```html
<h2>Your Airhead sign-in code</h2>
<p>Type this code in the app: <strong>{{ .Token }}</strong></p>
<p>Or, in a browser, <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>
```

Save. Then in **Authentication → URL Configuration** set **Site URL** to `http://localhost:5173` for now and add `http://localhost:5173/**` to **Redirect URLs** (the Cloudflare address gets added in Task 1.7).

### 4. Google login (Task 1.5)

Follow `docs/SETUP-GOOGLE-LOGIN.md` for `airhead-dev`. Until then, email codes work.

### 5. Cloudflare Pages for the dev site (Task 1.7)

1. Go to https://dash.cloudflare.com and sign in (a free account is fine).
2. **Workers & Pages → Create → Pages → Connect to Git** → authorise GitHub → choose **TCannonx/airhead** (grant access to that repo only).
3. Project name: `airhead` (gives `https://airhead.pages.dev`). Production branch: `main`.
4. Build settings: Framework preset **None** (or Vite); Build command `npm run build`; Build output directory `dist`.
5. **Environment variables** (set for both *Production* and *Preview*), using the **dev** project's values:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Supabase dev → Project Settings → API; the publishable/anon key)
   - `NODE_VERSION` = `24` (the repo also has a `.node-version` file)
6. **Save and Deploy.** Every PR then gets a preview link automatically.
7. Add the new address to sign-in: Supabase dev → **Authentication → URL Configuration** → Site URL `https://airhead.pages.dev`, Redirect URLs add `https://airhead.pages.dev/**` and `https://*.airhead.pages.dev/**` (PR previews). If Google login is set up, add `https://airhead.pages.dev` to the OAuth client's JavaScript origins.
8. For the live release workflow (Task 1.8), also create a Cloudflare API token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template (it includes Pages), and add GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account ID is on the Workers & Pages overview page).

### 6. Branch protection needs GitHub Pro (Task 1.8)

GitHub refuses branch protection and rulesets on a **private** repo on the free plan (`403 Upgrade to GitHub Pro or make this repository public`). Choose one:
- **Upgrade to GitHub Pro** (github.com/settings/billing), then tell Claude Code "GitHub Pro is on". It applies the protection with the exact call recorded in `docs/DECISIONS.md`.
- **Keep the free plan.** Until then, a local hook blocks pushes to `main`, and Claude Code's merge script merges only when all six CI jobs (lint, typecheck, unit tests, e2e tests, function tests, database tests) have run and passed.

### 7. Secrets for the live release (before the first `v*` tag)

Add to https://github.com/TCannonx/airhead/settings/secrets/actions: `VITE_SUPABASE_URL_LIVE`, `VITE_SUPABASE_ANON_KEY_LIVE` (live project → Project Settings → API), plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (item 5, step 8). In Cloudflare create a second Pages project named `airhead-live` using **Direct Upload** (not Git), since the release workflow uploads to it. The release workflow fails loudly, before touching anything, if any secret is missing.

### 8. Background sorting: two Vault secrets (Task 3.3)

The scheduler calls `sort-batch` every 5 minutes, but only once it knows the project address and service key. In **each** project: dashboard → **SQL Editor** → New query, paste and run (replace the two values; the key is under **Project Settings → API Keys → service_role / secret**):

```sql
select vault.create_secret('https://tfxpbxmkvlwxybaysjxy.supabase.co', 'project_url');
select vault.create_secret('<the service role key>', 'service_role_key');
```

For live, use `https://qqobvcelbzhrcehqukrs.supabase.co` and the live key. Until then, sorting still runs when the app opens and from **Sort now** in the Inbox.

### 9. Anthropic API key with a spend limit (needed from Phase 3)

Plan setup step 2. In the Claude Console (https://platform.claude.com): **Settings → Limits** set a monthly spend limit, then **API keys → Create key** (name `airhead-dev`). Put it straight into Supabase, never into chat or the repo: dashboard → project **airhead-dev** → **Edge Functions → Secrets** → **Add new secret**: name `ANTHROPIC_API_KEY`, value: the key. (Repeat with a separate `airhead-live` key in the live project before the first release.) Until then, AI sorting simply waits: captures stay in Unsorted and nothing breaks.


### 10. Push notification keys (Task 4.11; needed for reminders)

VAPID keys let Airhead's server send notifications. Make them on this computer so the private key never passes through chat or the repo:

1. In the repo folder: `npx deno@2.9.6 run scripts/generate-vapid-keys.ts > vapid.env`
2. Open `vapid.env` and change `VAPID_SUBJECT` to `mailto:` plus your own email address.
3. `npx supabase secrets set --env-file vapid.env --project-ref tfxpbxmkvlwxybaysjxy` (dev). Before the first release, do the same for live (`qqobvcelbzhrcehqukrs`); using the same keys keeps existing subscriptions working after the release.
4. Delete `vapid.env`.
5. On the iPhone: open Airhead from the Home Screen → Settings → Notifications → **Turn on notifications** → **Send test notification**.

Until the keys are set, the Notifications section says the server isn't set up yet; nothing else is affected.
