# Blockers

## Waiting for the user

### Update the live secrets (live project was recreated)

The live project is now `qqobvcelbzhrcehqukrs` (Frankfurt). At https://github.com/TCannonx/airhead/settings/secrets/actions, update `SUPABASE_PROJECT_REF_LIVE` to `qqobvcelbzhrcehqukrs` and `SUPABASE_DB_PASSWORD_LIVE` to the new live database password. Until then, the live keep-alive and backup jobs fail (dev is unaffected).

### GitHub Actions minutes used up (2026-11-07) — resolved

The account's 2,000 free minutes ran out. On the user's instruction the repo was made **public** (Actions are free for public repos). No secrets are in the history; it was checked before the switch.

To make it private again: GitHub → the repo → Settings → General → Danger Zone → Change visibility. Each merged PR then costs about 12 minutes (after `fix/ci-minutes`), roughly 165 PRs a month. Forks or clones made while it was public stay public.

### Phase 9 ready for device testing — all phases built, v0.1 ready to release

Phase 9 (Notebook polish) is merged and deploys to dev. Every phase in `docs/PLAN.md` is now built. To release v0.1:
1. Run `docs/MANUAL-CHECKLIST.md` on the iPhone, iPad and desktop Chrome against dev (https://airhead.xxr5th.workers.dev).
2. Finish item 7 (live secrets and the `airhead-live` Pages project) and set items 8–10 in the live Supabase project.
3. Create the tag `v0.1.0` (or tell Claude Code to). `release.yml` deploys that commit to `airhead-live`.

### Phase 8 ready for device testing and release

Phase 8 (Reflection) is merged and deploys to dev. The weekly review, Scout's web ideas and "Ask Airhead to pick" need item 9 (Anthropic key). The scheduled review needs item 8 (Vault secrets). Set a city in Settings → Scout for web ideas. Run the Phase 8 section of `docs/MANUAL-CHECKLIST.md`.

### Phase 7 ready for device testing and release

Phase 7 (Thinking tools) is merged and deploys to dev. The Shortcuts need a capture token (Settings → Capture from anywhere) and `docs/SETUP-SHORTCUTS.md`. Flesh-out, sessions and Ask need item 9 (Anthropic key); embeddings need item 8 (Vault secrets) so the scheduler can run `embed-items`. Run the Phase 7 section of `docs/MANUAL-CHECKLIST.md`.

### Phase 6 ready for device testing and release

Phase 6 (Notes) is merged and deploys to dev. Summarise needs item 9 (Anthropic key); everything else works without it. Run the Phase 6 section of `docs/MANUAL-CHECKLIST.md` (the iPad with the Pencil matters most).

### Phase 5 ready for device testing and release

Phase 5 (Today and morning brief) is merged and deploys to dev. The brief needs items 8 (Vault secrets, for the scheduler), 9 (Anthropic key) and 10 (VAPID keys, for the round-up). Without the key, the morning list still arrives as the code-built fallback. Run the Phase 5 section of `docs/MANUAL-CHECKLIST.md`.

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

### 3. Email-and-password sign-in, invite-only (replaces email codes) — do this in each Supabase project

Sign-in is email + password with **no emails sent**; new accounts are made on the spot, but only for addresses on the allow-list. In the Supabase project (dev now, live later):

1. **Authentication → Sign In / Providers → Email**: turn **Confirm email** off. Save.
2. **Authentication → Hooks** → add **Before User Created** → type **Postgres** → schema `public`, function `hook_before_user_created` → enable and save. (Without this, anyone with the address could sign up.)
3. **Table Editor → `signup_allowlist` → Insert row**: `entry` = your email in lower case (one row per person; `@domain.com` allows a whole domain). Save.
4. **Authentication → Users**: delete any account left over from the old email-code sign-in (e.g. yours), so you can sign up fresh with a password.
5. On the site, tap **New here? Create an account**, enter your email, and let the iPhone suggest a strong password. You're in; the password is in your Keychain for every device.

Forgotten password: there's no reset email (no email sender is set up). The password lives in iCloud Keychain / Chrome, so this should be rare; if it happens, a reset path can be added then (an email sender such as Resend, or an owner-run reset).

### 4. Google login (Task 1.5)

Optional. Follow `docs/SETUP-GOOGLE-LOGIN.md` for `airhead-dev`; the Google button appears only once Google is switched on in Supabase. New Google accounts also need their address on the allow-list (item 3).

### 5. Cloudflare hosting for the dev site (Task 1.7) — done 2026-11-07

The dev site is a Cloudflare **Worker** connected to `TCannonx/airhead` (Cloudflare's "Create" now makes Workers, not Pages): **https://airhead.xxr5th.workers.dev**. Every merge to `main` rebuilds it; PR builds get `https://<name>-airhead.xxr5th.workers.dev` preview addresses.

- Build variables (Worker → **Settings → Build → Variables and secrets**): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (dev values) and `NODE_VERSION` = `24`. `VITE_SUPABASE_URL` is the bare project address `https://<ref>.supabase.co` (not the Data API address ending `/rest/v1/`; the app now tidies that anyway). Names must be exact; a misspelt `VITE_SUPABASE_URL` silently builds a local-only app. Changes apply from the next build (**Deployments → ⋯ → Retry build**). PR preview builds keep **their own copy** of the build variables: pick a preview branch in the picker at the top of the Worker page, then **Settings → Build → Variables and secrets**. A build's own page (**Build settings → Build variables**) shows the names it used.
- Checked: the build carries the dev project's URL and anon key, deep links like `/share` serve the app, and `public/_headers` is applied.
- Still to do: Supabase dev → **Authentication → URL Configuration** → Site URL `https://airhead.xxr5th.workers.dev`, Redirect URLs add `https://airhead.xxr5th.workers.dev/**` and `https://*-airhead.xxr5th.workers.dev/**`. If Google login is set up, add `https://airhead.xxr5th.workers.dev` to the OAuth client's JavaScript origins.

- For the live release workflow (Task 1.8), still create a Cloudflare API token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template (it includes Pages), and add GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account ID is on the Workers & Pages overview page).

### 6. Branch protection (Task 1.8) — now possible: the repo is public

Public repos get branch protection on the free plan. Claude Code's permission check blocked it from changing protection itself, so either run this once (`!` prefix in Claude Code) or tell Claude Code it may:

```
gh api -X PUT repos/TCannonx/airhead/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"checks":[{"context":"checks"},{"context":"unit tests"},{"context":"e2e tests"},{"context":"e2e sync tests"},{"context":"database tests"}]},
 "enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0},
 "restrictions":null,"allow_force_pushes":false,"allow_deletions":false,"required_linear_history":true}
JSON
```

Or in the browser: Settings → Branches → Add classic branch protection rule for `main` → require a pull request (0 approvals), require these status checks (strict), include administrators, block force pushes and deletions. Until then, the merge script merges only when all five CI jobs have passed. If the repo goes private again, the protection is suspended on the free plan.

### 7. Secrets for the live release (before the first `v*` tag)

Add to https://github.com/TCannonx/airhead/settings/secrets/actions: `VITE_SUPABASE_URL_LIVE`, `VITE_SUPABASE_ANON_KEY_LIVE` (live project → Project Settings → API), plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (item 5, step 8). In Cloudflare create a second Pages project named `airhead-live` using **Direct Upload** (not Git), since the release workflow uploads to it. The release workflow fails loudly, before touching anything, if any secret is missing.

### 8. Background sorting: two Vault secrets (Task 3.3)

The scheduler calls `sort-batch` every 5 minutes, but only once it knows the project address and service key. In **each** project: dashboard → **SQL Editor** → New query, paste and run (replace the two values). For the key use a **Secret key** (`sb_secret_…`) from **Project Settings → API Keys**, not the legacy `service_role` key: on dev the legacy key shown in the dashboard did not match the one Supabase gives the functions, so every background call got 401 "Service only".

```sql
select vault.create_secret('https://tfxpbxmkvlwxybaysjxy.supabase.co', 'project_url');
select vault.create_secret('<the sb_secret_ key>', 'service_role_key');
```

To replace a key already stored: `select vault.update_secret((select id from vault.secrets where name = 'service_role_key'), '<the sb_secret_ key>');`. Delete the query afterwards (it contains the key). For live, use `https://qqobvcelbzhrcehqukrs.supabase.co` and the live key. Until then, sorting still runs when the app opens and from **Sort now** in the Inbox.

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
