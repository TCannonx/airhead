# Decisions

Decisions and library versions, newest first.

## 2026-11-07 — Task 3.2 Sort batch
- **`sort-batch` Edge Function** (`verify_jwt = false`; it authenticates itself): called by the app with the user's access token (on demand), or by the scheduler with the service key and `{ user_id }` (background, Task 3.3). Without `ANTHROPIC_API_KEY` it answers `503 not_configured` ("AI sorting is not set up yet") and captures simply wait.
- Takes up to **20** of the user's oldest `unsorted` captures with text or a link (photo-only captures wait for Phase 6 vision). Digest: now + time zone (`settings.data.time_zone`, default Europe/Dublin), topic names, up to 30 open idea titles, list names, and the last 5 corrections **with the capture text they were about**. One small-tier call with effort `low`, max 8,000 output tokens.
- **Prompt** `_shared/prompts/sort-batch.v1.ts` (versioned file): fixed system text (cached) + a per-request user message where every capture sits in `<capture id>` blocks, stated to be data, not instructions; a literal `</capture>` inside a capture is escaped.
- **Output schema** (`_shared/schemas/sort.ts`): per capture, an array of items with `type`, `title`, `body`, `start_at`/`end_at` (ISO with offset), `all_day`, `due_at`, `rrule`, `list_name`, `topics`, `confidence`, `suggest_workshop`, `related_idea_title`. Optional values are `nullable` rather than absent, which suits strict structured outputs.
- **The model suggests, Airhead's rules decide** (`sort-batch/plan.ts`, pure and tested on saved responses):
  - events are `open` only when confidence ≥ 0.8 **and** the start is in the future; otherwise `suggested`.
  - any item below 0.6 is `suggested`, and the capture becomes `needs_review`.
  - a list entry for an unknown list is `suggested` with `data.proposed_list` (the Task 3.6 "Create list?" prompt).
  - topics are capped at 3 and reused case-insensitively, with new ones created.
  - `suggest_workshop` → `data.workshop`; a matched related idea → `data.related_idea_id`.
  - results for capture ids not in the batch are ignored; captures the model skipped are marked `failed` ("Couldn't sort"), so a broken capture isn't retried forever.
- **Applied atomically** by `apply_sort_batch(user, plan)` (plpgsql, security definer, service role only). It locks the batch's captures and applies items **only for captures still `unsorted`**, so one edited, sorted or deleted on a device meanwhile is left alone. Devices pick up the new rows through normal sync (Realtime nudge).
- Saved model output lives in `tests/fixtures/ai/sort-batch.json` (brain dump → two shopping-list entries + event + task; ambiguous capture → review; new topic + workshop + related idea).

## 2026-11-07 — Task 3.1 AI gateway
- **Verify (model IDs and prices)**, from Anthropic's current model table (Claude API skill, cached 2026-10-06): small tier **`claude-haiku-5-5`** ($0.10 in / $0.50 out per MTok for prompts up to 100K tokens; cache reads $0.01, 5-minute cache writes $0.125 = 1.25× input), large tier **`claude-sonnet-5-5`** ($2 / $10; cache reads $0.20, writes $2.50). These follow the design doc's own choice ("small, e.g. Claude Haiku"; "larger, e.g. Claude Sonnet"); IDs live in `MODELS` in `_shared/ai.ts`. The price table is seeded with these values and is editable per user (`ai_prices` rows with the user's id override the defaults).
- **`eur_rate` seeded at 0.86 euros per dollar as a placeholder**, editable in Insights → AI usage (3.7). The Claude Console is the true record of spend; the app's figures are estimates.
- **Structured output via `output_config.format`, not forced tool use.** The plan says to force JSON output with a tool, but current models reject forced `tool_choice` (`any`/`tool`) with a 400. The gateway calls the SDK's `messages.parse` with `zodOutputFormat(schema)` (JSON-schema structured output), re-validates with Zod, and retries once on invalid output (including JSON the SDK couldn't parse).
- **SDK `npm:@anthropic-ai/sdk@1.6.0`** (Zod peer `^3.25 || ^4`), `npm:zod@4.6.7`, pinned in the import specifiers.
- **Usage rows**: one per *attempt* (tokens were spent), including failures: `cap_reached` (nothing sent), `api_error` (no retry: the batch stays queued for the next run), `invalid_output`, `refused` (`stop_reason: "refusal"`, not retried). Cost = tokens × prices (input, output, cache read, cache write) × `eur_rate`, rounded to 6 decimals.
- **Monthly cap**: `settings.data.ai_monthly_cap_eur` (absent or 0 = no cap). Month-to-date comes from `ai_month_to_date_eur(user)` (calendar month in Europe/Dublin, failed attempts included), callable only by the service role. Background tasks return `cap_reached` and leave work queued; on-demand callers show the plain message.
- **Prompt caching**: the fixed system prompt is sent as a `cache_control: ephemeral` block; per-request content goes in `messages`. Haiku 5.5's 100K+ prompt price tier is ignored (batches are far smaller).
- **Refusal fallbacks** (the server-side `fallbacks` option recommended for Sonnet 5.5) are left for the first large-tier task (Phase 5): sorting uses Haiku 5.5, which has no server-side fallback, and a refused batch simply stays unsorted.
- `ai_usage` is not synced to devices: users read it through the `ai_usage_mine` view (security invoker; RLS restricts it to their rows), and only the gateway (service role) writes it. CI now runs `deno check` on every shared module and function entry point.

## 2026-11-07 — Task 2.10 Sync visibility
- **Indicator** (`SyncIndicator`): a coloured dot and a label in the phone top bar and under the brand in the iPad/desktop sidebar. Labels: "Synced", "Syncing…", "N waiting", "Offline" / "Offline · N waiting", "N waiting · will retry" / "Not synced yet · will retry". The engine's plain-language message is the tooltip. "N" = distinct rows in the outbox, refreshed after every local write. It's `aria-live="polite"` rather than `role="status"`, to avoid competing with toasts.
- **Hidden in local mode** (nothing syncs); Settings → Sync explains it instead.
- **Settings → Sync**: last successful sync ("Today at 10:41" / "Thu 5 Nov at 08:05" / "Never"), the current message, and a visible **Sync now** button.
- The cross-device e2e now checks the indicator reads "Offline · N waiting" while offline and "Synced" after reconnecting.

## 2026-11-07 — Task 2.9 Export everything
- **JSZip 3.10.2.** Settings → Your data → **Export everything** downloads `airhead-export-YYYY-MM-DD.zip`:
  - `data.json`: `{ format: 'airhead-export', version: 1, exported_at, tables }` with **every row of every synced table, soft-deleted rows included** (it's the backup and re-import source; the version field allows a future importer).
  - `items/<type>/<created-date>-<slug>.md`: one Markdown file per **live** item, with YAML front matter (type, status, dates, repeats, calendar, url, topics, id), the title as `#`, the body, and the original capture quoted under "Original capture".
  - `files/<user>/<capture>/<file>`: attached photos as stored on the device; plus a short `README.md`.
- YAML values are quoted only when they'd otherwise be misread, so URLs and timestamps stay readable.
- The download uses an object URL and `<a download>`; on iOS this opens the share/save sheet.

## 2026-11-07 — Task 2.8 On-device search
- **MiniSearch 7.2.0** (MIT). One in-memory index per user database covers item titles (boosted ×2) and bodies, and capture text. Prefix matching and fuzzy 0.2 ("compsting" finds "Composting"); all words must match (AND).
- **Incremental**: `SearchIndex.sync(items, captures)` re-indexes only rows whose `updated_at` changed (`replace`), adds new ones, and `discard`s deleted or dropped ones. It's fed by a Dexie live query, so new captures are searchable immediately, offline included. Not persisted: the index is rebuilt in memory on app open, which is fast at personal scale.
- **Visible Search box** at the top of the Library; results link to the item, or to the Inbox for a capture. **"/"** on iPad and desktop layouts navigates to the Library and focuses the box, except while typing in an input, textarea, select or contenteditable. There's no shortcut on the phone (no hardware keyboard by default).

## 2026-11-06 — Task 2.7 Inbox and Library (basic)
- **Inbox → Unsorted** lists captures with status `unsorted`, `needs_review` or `failed`, newest first, each with one-tap **Sort as** buttons (Task, Event, Reading, Idea, Meeting, Note). Sorting by hand creates the item (title = first line of the capture, capitalised; multi-line text kept as the body; links kept in `data.url`), marks the capture `sorted`, and records a `corrections` row (`from_value: { status }`, `to_value: { type }`).
- **Inbox → To flesh out** shows items with `data.workshop === true` (set by sorting/Workshop in later phases).
- **Library**: type tabs (All, Tasks, Events, Reading, Ideas, Meetings, Notes), Topic filter, From/To date filter (on `created_at`). It hides deleted, dropped and still-suggested items. Lists get their own screen with Task 3.6.
- **Item page** (`/library/item/:id`): edit title, notes and type; changing the type records a correction (`from_value: { type }` → `to_value: { type }`); Delete soft-deletes and returns to the Library.
- **Trash** (`/library/trash`): items deleted in the last 30 days, newest first, with Restore; the nightly server purge removes them after that.

## 2026-11-06 — Task 2.6 Instant events and suggestions
- **Confident date** → an `event` item (status `open`, calendar `personal`, start/end/all-day/RRULE from the rules) is saved with the capture, and the capture is marked `sorted` (the free rules handled it). An **"Event added: Sat 11:00 · Undo"** toast (`role="status"`) shows for 8 s (`TOAST_MS`).
- **Undo** soft-deletes the event (recoverable from Trash for 30 days) and sets the capture back to `unsorted`, so the next AI batch sorts it instead.
- **Fuzzy date** → an `event` item with status `suggested`; the capture becomes `needs_review`. Suggestion cards sit at the top of **Today** ("Add to calendar" → `open` on Personal; "Dismiss" → `dropped`); either marks the capture `sorted`. (The Inbox's one-tap review choices for AI sorting arrive in Phase 3.)
- **Chips**: `Event added: <when>` / `Suggestion: <when>`; `<when>` is "Sat 11:00" within the next 7 days, "Sun 20 Dec, 20:00" beyond, and no time for all-day items.
- Hedge words (sometime, maybe, possibly, probably, perhaps) count for the confidence rule but are left out of titles ("sometime next week call the bank" → "Call the bank").
- The rules always return plain UTC ISO strings (`TZDate.toISOString()` writes an offset, which would mix formats in the database).
- Everything here is local (Dexie), so it works fully offline; sync carries the event to other devices.

## 2026-11-06 — Task 2.5 Free rules
- Libraries: **chrono-node 2.10.3** (`chrono.en.GB` with `forwardDate: true` and `{ instant, timezone: 'Europe/Dublin' }` as the reference, so "3/4" is 3 April and times convert through BST/GMT correctly), **rrule 2.8.1** (RRULE validation now, expansion later), **date-fns 4.4.0** + **@date-fns/tz 1.5.0** (`TZDate` for local days in the user's zone).
- **Confidence rule** (exactly when an event may be created without asking): explicit date (a day, weekday, "today/tonight/tomorrow", or a recurrence) **and** (explicit time **or** all-day wording: birthday, anniversary, holiday, day off, all day) **and** in the future **and** no fuzzy words. Fuzzy: sometime, maybe, possibly, probably, perhaps, around, roughly, approx, at some point, soon, TBC/TBD, "or so", "-ish" (e.g. "8ish"), and a bare "next/this week/month" without a weekday. Time-only phrases ("lunch at 1pm") are not confident.
- **"8ish" times are hidden from the parser** (blanked to the same length, so positions still line up): "coffee Tue 3ish" is a date-only suggestion, "dinner at 8ish" has no date.
- **Recurrence parser** (own code, `src/lib/rules/recurrence.ts`): daily / every day, every N days/weeks/months, fortnightly / every other week, every weekday, weekday lists ("Tues and Thurs", "Mon, Wed & Fri") and plurals ("Mondays"), every <weekday>, weekly, monthly (+ "on the 1st" → BYMONTHDAY), yearly / annually; birthdays and anniversaries become `FREQ=YEARLY`. A weekday list counts as recurring ("training Tues and Thurs 7pm" → `FREQ=WEEKLY;BYDAY=TU,TH`). RRULEs carry no DTSTART: the item's `start_at` is the first occurrence (computed in the user's zone, after now).
- Recurrence words are hidden from chrono (so "every 2 weeks" isn't "in 2 weeks"); when chrono returns the date and time as separate results ("4/3 dentist at 9am"), the time is merged in.
- **All-day items**: `start_at` is local midnight of the first day; ranges store `end_at` as local midnight of the **last** day (inclusive). Conversion to iCalendar's exclusive DTEND happens in the feed (Task 4.8).
- **Titles** drop the date, recurrence, "-ish" and link parts and dangling connectors (at/on/every/...), then capitalise the first letter; the capture's original text is never changed.
- **Links**: any http(s) URL in the text makes the capture `kind: 'link'`, marks it `sorted` (fixed 2026-11-07: it had stayed in Inbox → Unsorted, inviting a duplicate) and creates a `reading` item (`data.url`, title from the remaining words or the URL). 36 phrases in the table test plus British-order and immutability checks.

## 2026-11-06 — Task 2.4 Capture tab
- **Paste link is always visible and reads the clipboard only on tap.** The plan's "a Paste button when the clipboard holds a URL (read only on tap)" can't be done literally: a page can't know what the clipboard holds without reading it (and reading unprompted triggers permission prompts on iOS). On tap: a URL becomes a `link` capture straight away; other text is added to the box.
- **Enter saves only with a fine pointer** (`(pointer: coarse)` doesn't match): desktop Enter saves and Shift+Enter adds a line; on touch, Enter adds a line and the always-visible **Save** button saves. IME composition is respected.
- **Photos**: `createImageBitmap` (EXIF orientation applied) → canvas at longest side 1600 px → `toBlob('image/webp', 0.8)`. If the browser can't encode WebP (it returns PNG), JPEG 0.85 is used.
- **Files are kept on the device in a non-synced Dexie table `files` (schema v2)** and stored as an `ArrayBuffer` + MIME type rather than a `Blob` (Blob storage in IndexedDB has been unreliable on older Safari). The capture records `payload.files[] = { id, path, mime, size }`. Storage path: `<user_id>/<capture_id>/<file_id>.<ext>` in the private `captures` bucket. The sync engine uploads pending files after each push (`Remote.uploadFile`); the bytes stay cached for offline viewing. Records are rewritten with `put` (Dexie's `update` copy mangled the stored bytes in tests).
- Recent captures (last 10) appear under the box with their chip: `Reading list` (links), `Sorting soon` (unsorted), `Sorted`, `Needs a tap`, `Couldn't sort`. Instant events from free rules arrive in 2.5/2.6.
- The plan's cross-device e2e for 2.3 ("captures offline, reconnects and sees the item on a second browser context") is `tests/e2e-sync/capture.spec.ts`, now that the Capture tab exists.

## 2026-11-06 — Supabase projects connected
- Projects: **airhead-dev** ref `tfxpbxmkvlwxybaysjxy` (eu-west-1, Ireland), **airhead-live** ref `qqobvcelbzhrcehqukrs` (eu-central-1, Frankfurt; the user recreated it there, replacing a first live project in Stockholm, `lqoausxpvthmfxvbpyrk`, which no longer exists). This clone is linked to **dev** only.
- GitHub Actions secrets set by the user: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_PROJECT_REF_LIVE`, `SUPABASE_DB_PASSWORD_DEV`, `SUPABASE_DB_PASSWORD_LIVE`.
- The Supabase GitHub integration is connected (the "Supabase Preview" check), and it had already applied migrations to dev on merge ("Remote database is up to date" on the first workflow deploy). `deploy-dev.yml` stays as the explicit route (functions, and migrations if the integration lags); `db push` is idempotent. The integration is attached to **dev only**; it must never be attached to live (that would deploy to live on every merge). Because both deploy functions on merge, the workflow retries `functions deploy` on failure (409 "Function was deployed concurrently").
- **Sign-in code cool-down**: Supabase Auth refuses a second code request for the same email within a few seconds ("For security purposes, you can only request this after N seconds"). The app now says "Wait N seconds, then try again." (`src/lib/auth/errors.ts`) instead of a vague failure; the sync e2e helper waits and retries; the local stack's `email_sent` rate limit is raised to 60/hour.
- **Supabase CLI 3.0 asks for confirmation on hosted changes** and refuses in a non-interactive run ("Re-run with --yes"). Only the `--yes` flag (or an exported `SUPABASE_YES`) is accepted, so the workflows pass `--yes` to `db push` and `functions deploy`. `functions deploy --project-ref` is deprecated in favour of `--remote=<ref>`.

## 2026-11-06 — Task 2.3 Sync engine
- **Push**: drain the outbox ordered by `seq`, de-duplicate per row, send each row's *current* state with `upsert(..., { onConflict: 'id' })` in batches of 100, then delete only the outbox entries that were sent (entries queued during a push survive).
- **Pull**: per table, keyset pages of 500 ordered by `(server_updated_at, id)` strictly after the last `(ts, id)`. **Each pull starts 60 s before the stored cursor** (`PULL_OVERLAP_MS`): `server_updated_at` is the transaction's start time, so a slow transaction can commit after a pull with a timestamp just before the cursor. Re-applying a row is harmless. Rows failing the Zod schema are skipped, never block sync.
- **Merge**: a local row with pending outbox entries is not overwritten by a pull (the local edit is newer and the next push makes it the server's version); otherwise the server row wins. "Conflicted copy" for notes edited on two devices comes with notes in Phase 6.
- **Triggers**: `start()` (app open), `online`, visible again, every 60 s while visible, 1 s after a local write (Dexie `outbox` creating hook), and Realtime. One run at a time; overlapping requests fold into a single follow-up run.
- **Realtime**: one `postgres_changes` channel on schema `public` (Realtime enforces RLS, so only the user's own rows arrive) used as a "something changed, sync now" nudge, rather than a custom per-user broadcast channel; the change payload itself is ignored and the normal pull fetches it.
- **Status**: `idle` / `syncing` / `offline` (browser offline) / `error` (online but failing: retries after 5 s, 15 s, 60 s, then every 5 min) with a pending count (distinct rows in the outbox) and `lastSyncedAt` (also stored in `meta`).
- **Devices are now local-first**: the device row is saved to Dexie and pushed by sync (registration works offline); Settings → Devices reads Dexie. The earlier direct-to-server `DeviceStore` from Task 1.5 is gone. `Services.remote` is the sync server (`null` in local mode).
- **Settings row id = user id** (for later tasks): `settings` has a unique `user_id`, so two devices creating it offline with random ids would conflict forever on push.
- **Cross-device e2e** (`tests/e2e-sync`, `playwright.sync.config.ts`, CI job `e2e sync tests`): `supabase start` without studio/imgproxy/edge-runtime/logflare/vector/supavisor/postgres-meta; the app is built against the local stack (`supabase status -o env`), two browser contexts sign in through the real UI with codes read from the local Mailpit API, and each must see the other's device (A via Realtime, without reload).
- **Email templates** with `{{ .Token }}` live in `supabase/templates/` (`magic_link.html`, `confirmation.html` for first sign-in) and are wired in `config.toml` for the local stack.

## 2026-11-06 — Task 2.2 Local database
- **Dexie 4.4.7** (+ dexie-react-hooks 4.4.0), **Zod 4.6.7**, **fake-indexeddb 6.2.7** (tests; loaded globally in `src/test/setup.ts`).
- **One IndexedDB database per user**: `airhead-<userId>`, opened by `DataProvider` after sign-in. Local mode uses the fixed id `00000000-0000-4000-8000-000000000001`.
- Tables mirror the synced Supabase tables (`settings`, `devices`, `captures`, `items`, `lists`, `topics`, `corrections`) plus `outbox` (`++seq`, table, row_id), `sync_state` (per-table cursor + ids seen at that cursor) and `meta`. `capture_tokens` stay server-only (managed in Phase 7).
- **The outbox stores (table, row id) only**; push sends the row's current state, so repeated edits coalesce.
- **`save()` is the only write path**: Zod-validates, stamps `updated_at`, and writes row + outbox entry in one Dexie transaction. Soft delete / restore are just saves of `deleted_at`.
- **Zod schemas** in `src/lib/schemas/records.ts` (shared with functions later): ids use `z.guid()` (any 8-4-4-4-12 hex), not `z.uuid()`, which in Zod 4 enforces RFC version bits; timestamps use `z.iso.datetime({ offset: true })` to accept Postgres' `+00:00`; `top3_date` uses `z.iso.date()`.
- **Persistent storage** is requested once (`navigator.storage.persist()`), and the answer is remembered in `meta`.
- **StrictMode gotcha**: cleanup closes the DB with `close({ disableAutoOpen: false })`, so the same instance reopens when React re-runs the effect; a plain `close()` left it permanently closed (`DatabaseClosedError`).

## 2026-11-06 — Task 2.1 Core tables
- **No foreign keys between synced tables** (`items.capture_id`, `list_id`, `series_id`, `corrections.capture_id`, ...). Devices push in batches per table in any order, and a row can legitimately arrive before the row it points at. Only `user_id → auth.users` is a real FK. The app treats links as soft.
- **`corrections.from_value` / `to_value`** instead of the plan's `from` / `to` (reserved words in SQL).
- **`items.status`** values: `open`, `suggested` (fuzzy events and AI proposals waiting for a tap, as suggestion cards), `done`, `dropped`. `items.confidence` is checked to 0–1.
- **Realtime**: all synced tables (plus `settings`, `devices`) are added to the `supabase_realtime` publication; Realtime applies RLS, so a device only hears its own user's changes.
- **Purge**: `public.purge_soft_deleted()` (security definer, not executable by app users) hard-deletes rows soft-deleted more than 30 days ago in every synced table; `pg_cron` job `purge-soft-deleted` runs it nightly at 03:17 UTC.
- **Storage**: private bucket `captures` (10 MB, webp/jpeg/png/pdf) created in the migration (so it reaches dev and live through `db push`), with select/insert/update/delete policies limited to `<auth.uid()>/...` paths.

## 2026-11-06 — Task 1.8 CI and safeguards
- **CI jobs** (`ci.yml`): `lint`, `typecheck`, `unit tests`, `e2e tests`, `function tests` (Deno via `denoland/setup-deno@v2`, `deno test --allow-env --allow-net=127.0.0.1 supabase/functions`), `database tests` (pgTAP). Edge Function tests import `jsr:@std/assert@1.0.19`; functions pin `npm:@supabase/supabase-js@2.119.0`.
- **Supabase CLI 3.0 targets the local database by default**: `db push` / `db dump` need `--remote` to reach the linked project, and `link` no longer takes a password. Checked with `--help`; all workflows use `link --project-ref`, then `--remote --password`.
- **`health` function**: `GET`/`HEAD` → `{ ok, error_code, message, time }`; runs a head-only count on `settings` so the free project registers real database activity; `verify_jwt = false` in `config.toml` (it is called without a user). Internal errors are never echoed.
- **`deploy-dev.yml`** (push to main): link dev → `db push --remote` → `functions deploy --use-api` (server-side bundling, no Docker). It **skips with a notice** while the secrets are missing so `main` doesn't go red before the user has created the projects. The static app is deployed by Cloudflare Pages' Git integration, not a workflow.
- **`release.yml`** (tag `v*`): re-runs lint, typecheck and unit tests, then deploys migrations, functions and the app (`wrangler@4.158.0 pages deploy` to the separate `airhead-live` Pages project, built with the live `VITE_*` values). It **fails before touching anything** if any secret is missing. Uses the GitHub environment `live`.
- **`keepalive.yml`**: daily 06:17 UTC, calls both projects' `health` (3 attempts). **`backup.yml`**: Sundays 03:23 UTC, `db dump --remote` roles, schema and data (`--use-copy`) for live, kept as a 90-day artifact. Both skip with a notice while secrets are missing. Note: GitHub disables scheduled workflows in repos with no activity for 60 days.
- **Branch protection: not available.** The exact call tried (REST, equivalent of `gh api`):
  `PUT /repos/TCannonx/airhead/branches/main/protection` with `required_status_checks.strict=true`, `checks=[lint, typecheck, unit tests, e2e tests, function tests, database tests]`, `enforce_admins=true`, `required_pull_request_reviews.required_approving_review_count=0`, `restrictions=null`, `allow_force_pushes=false`, `allow_deletions=false`, `required_linear_history=true`.
  Result: `403 Upgrade to GitHub Pro or make this repository public`. The rulesets API (`POST /repos/TCannonx/airhead/rulesets`, same rules) returns the same 403. Recorded in BLOCKERS. **Stand-in until then**: the local hook blocks pushes to `main`, and the merge script refuses to merge unless all six required jobs ran and passed.

## 2026-11-06 — Task 1.7 Hosting
- **Verify (Cloudflare Pages SPA and headers)**, from the official docs (`pages/configuration/serving-pages`, `pages/configuration/headers`): with no top-level `404.html`, Pages serves the root for any path that isn't a static asset (SPA mode), so no `_redirects` catch-all is needed; `_headers` rules that match the same path *add up*, duplicate values are comma-joined, `! Name` removes a header, max 100 rules; Cloudflare advises against custom caching in most cases.
- `public/_headers`: security headers on `/*`; `Cache-Control: no-cache` only on `/sw.js` and `/manifest.webmanifest` so new versions reach devices. A node-environment test guards these and the absence of `404.html`.
- `.node-version` = 24 for the Pages build image (plus `NODE_VERSION` in Pages settings; the build-configuration page doesn't state the default Node version).
- **Two Pages projects**: `airhead` builds from `main` (dev data, plus PR previews); live is a separate project `airhead-live`, deployed only by `release.yml` on a `v*` tag (Task 1.8), so the dev site can never serve live config.
- Node-only tests live in `tests/node/` (covered by `tsconfig.node.json` and the Vitest include list).

## 2026-11-06 — Scope: all phases
- The user instructed (2026-11-06, in session): "go through all phases and complete as many as possible without my input". `PLAN.md` says phases 5–9 should only be planned in detail after v0.1 has been used for a few weeks. The user's later, explicit instruction wins: after Phase 4, each of phases 5–9 first gets a detailed task list written into `PLAN.md` from `DESIGN.md` (one PR), then is built task by task as usual. Live releases still wait for the user.

## 2026-11-06 — Task 1.6 App lock
- **Per-device settings in `localStorage`** (`airhead.appLock`: enabled, credential id, time-out), not in the synced `settings` row, because a Face ID / Touch ID credential belongs to one device.
- **WebAuthn platform credential** (`authenticatorAttachment: 'platform'`, `userVerification: 'required'`, `residentKey: 'discouraged'`, ES256/RS256, `attestation: 'none'`). Unlock = a successful `navigator.credentials.get` with user verification; there is **no server verification**, because the lock is a privacy screen, not a login or encryption (stated in Settings).
- **Unlock needs a tap** on "Unlock with Face ID / Touch ID": iOS Safari only allows WebAuthn from a user gesture, so it isn't auto-prompted on open.
- **Time-out**: Immediately / 1 / 5 / 15 / 60 minutes (default 5). Activity = pointer or key events; the lock is checked when the app becomes visible again and every 15 s while open. "Immediately" locks every time the app is left, never while in use.
- **Recovery**: the lock screen's "Sign out" clears this device's lock and signs out; signing back in gives an unlocked app.
- E2E test drives the real WebAuthn code with Chrome's CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`, internal transport, user verification on).
- React compiler lint rules (`eslint-plugin-react-hooks` 7) forbid impure calls and ref writes during render; such work lives in effects.

## 2026-11-06 — Task 1.5 Sign-in
- **@supabase/supabase-js 2.119.0**, `flowType: 'pkce'`, persistent session, auto refresh. `getSession()` reads the stored session, so the app opens signed in while offline.
- **Google is login only**: `signInWithOAuth({ provider: 'google' })` with no extra `scopes`, so Supabase requests only the basic openid/email/profile scopes. No calendar, Drive or Gmail access.
- **Email fallback is a 6-digit code, not only a magic link.** On iOS an installed home-screen app has its own storage, separate from Safari: a magic link tapped in Mail opens Safari and signs *Safari* in, not the installed app (and with PKCE the code verifier isn't even there). So the fallback sends one email carrying both a code and a link; the app asks for the code (`verifyOtp({ type: 'email' })`). This needs `{{ .Token }}` in the Supabase magic-link email template (BLOCKERS). This departs from the plan's wording ("email magic link") in mechanism only, not in what is built.
- **Whether Google OAuth completes inside the installed iOS app must be checked on the device** (Phase 1 manual checklist). If it opens Safari and doesn't return, the email code is the working route on iPhone.
- **Local mode**: when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` aren't set, the app runs signed in as a local user and nothing leaves the device (Settings says so). This keeps local development and the e2e tests working before the projects exist. Production builds always have the variables.
- **Auth is behind a small `AuthClient` interface** (`src/lib/auth/types.ts`) with Supabase, local and test implementations; tests never touch the network.
- **Devices**: a random device id is created once per install (`localStorage` key `airhead.deviceId`); on sign-in the device is upserted with `ignoreDuplicates`, so a later rename isn't overwritten. Platform detection treats "Macintosh" plus touch as iPad. Settings lists devices and marks "This device".
- Sign-out is `scope: 'local'` (this device only).

## 2026-11-06 — Task 1.4 Supabase setup
- **Supabase CLI 3.0.0** as an npm dev dependency (`npx supabase …`), so CI and this machine use the same version. `supabase init` created `supabase/config.toml` (Postgres 17); local auth `site_url` is `http://localhost:5173`.
- **Migration file naming**: the CLI needs timestamped names, so the plan's "0001" is `20261106000001_foundation.sql`; later migrations follow the same `2026MMDD0000NN_<name>.sql` pattern.
- **Sync columns + trigger** exactly as the plan's Data model; `user_id` defaults to `auth.uid()` so the client never has to send it. `settings` has a unique `user_id` (one row per user).
- **RLS**: four policies per table (`select`/`insert`/`update`/`delete`) for `authenticated`, all `user_id = (select auth.uid())` (the sub-select form Supabase recommends for performance). `anon` has all privileges revoked on these tables as defence in depth.
- **RLS tests are pgTAP** (`supabase/tests/database/*.test.sql`, run by `supabase test db`), Supabase's standard database test route. Docker isn't on this machine, so they run in CI only.
- **CI brought forward from Task 1.8**: `.github/workflows/ci.yml` (jobs `lint`, `typecheck`, `unit tests`, `e2e tests`, `database tests`) is added now, because the RLS test has to run somewhere before merge. Task 1.8 adds the deploy, release, keep-alive and backup workflows and branch protection.
- GitHub Actions versions checked against each repo's latest release: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`.
- **Linking `airhead-dev` waits on the user** (the projects don't exist yet); see BLOCKERS.

## 2026-11-06 — Task 1.3 Responsive layout
- **React Router 8.5.1 in data mode**: `createBrowserRouter` from `react-router`, `RouterProvider` from `react-router/dom` (per the package's own `docs/start/data/installation.md`). Routes live in `src/app/routes.tsx` so tests can use `createMemoryRouter` with the same table.
- **Layout is chosen in JavaScript, not only CSS**: `layoutFor(width)` (phone < 768, tablet 768–1279, desktop ≥ 1280) with a `useSyncExternalStore` resize hook. Only one navigation is in the DOM at a time, so screen readers and tests see exactly one.
- `/` redirects to `/capture` (Capture is the home screen); unknown paths do too.
- On the phone, Settings is a gear button in the top bar (five tabs fit; no hidden commands). On iPad and desktop it sits at the foot of the sidebar.
- The desktop right panel is a placeholder ("Today at a glance") until Phase 5 fills it.
- Light/dark follows the system (`prefers-color-scheme`, Tailwind's default `dark:` variant). Safe areas use `env(safe-area-inset-*)` with `viewport-fit=cover`.
- Icons are hand-drawn inline SVGs in `src/app/Icon.tsx`; no icon library yet.

## 2026-11-06 — Task 1.2 PWA shell
- **Verify (iOS home-screen requirements):** iOS still takes the home-screen icon from `<link rel="apple-touch-icon">` (180×180 PNG, not the manifest), turns transparent pixels black, and supports only `display: standalone`. It also honours `apple-mobile-web-app-capable`, `-title` and `-status-bar-style` meta tags. If the manifest loads late, "Add to Home Screen" makes a plain bookmark, so the manifest link is in the static HTML. Sources: web.dev "PWA enhancements"; vite-pwa injectManifest guide. Splash screens (`apple-touch-startup-image`) are skipped for now.
- **vite-plugin-pwa 2.0.0, `injectManifest`** with `srcDir: 'src/sw'`, `filename: 'sw.ts'`; Workbox 7.4 modules (`workbox-precaching`, `-routing`, `-core`). The SW precaches the built shell, serves `index.html` for every navigation (deep links work offline), and calls `skipWaiting` + `clientsClaim` (data lives in IndexedDB, so swapping the shell is safe). `registerType: 'autoUpdate'`, registered in `src/main.tsx` via `virtual:pwa-register`; dev-mode SW off.
- The service worker has its own `tsconfig.sw.json` (WebWorker lib); `src/sw` is excluded from the app tsconfig.
- **Placeholder icons** are generated from `public/logo.svg` with `@vite-pwa/assets-generator` 2.0.0 (`minimal-2023` preset, solid background for the Apple and maskable icons). Regenerate with `npx pwa-assets-generator`.
- Theme colour `#4f46e5` (indigo) light, `#020617` dark; `background_color` white.

## 2026-11-06 — Task 1.1 scaffold
- **TypeScript held at 6.0.x (`~6.0.3`), not 7.0.** The current Vite template ships TypeScript 7.0.2, but `typescript-eslint` 8.72.1 (current) supports only `>=4.8.4 <6.1.0`, and the plan requires ESLint. Revisit when typescript-eslint supports TS 7.
- **ESLint, not oxlint.** The current `create-vite` template uses oxlint; the plan specifies ESLint, so ESLint 10 flat config is used with `typescript-eslint` strict, `eslint-plugin-react-hooks` (flat recommended), `eslint-plugin-react-refresh` (vite preset) and `eslint-config-prettier`. `npm run lint` runs ESLint then `prettier --check`.
- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, plus the template's unused/erasable-syntax checks.
- **Tailwind CSS 4** through the `@tailwindcss/vite` plugin (`@import 'tailwindcss'` in `src/index.css`); no `tailwind.config` file needed in v4.
- **Vitest** has its own `vitest.config.ts` merged over `vite.config.ts`, jsdom environment, `@testing-library/jest-dom/vitest` in `src/test/setup.ts`.
- **Playwright locally uses the installed Google Chrome** (`channel: 'chrome'`) so no browser binaries are downloaded onto the machine; CI installs Playwright's Chromium. E2E runs against `vite preview` on port 4173.
- **Line endings**: `.gitattributes` forces LF and `core.autocrlf=false` is set in this clone, so Prettier and Git agree on Windows.
- **GitHub repo** `TCannonx/airhead` (private) created through the REST API (`POST /user/repos`) with squash-only merges, auto-merge allowed and delete-branch-on-merge, which matches the `gh repo edit` flags in `CLAUDE.md`. A local hook blocks pushing to `main`, so the repo was created with GitHub's initial commit and the docs landed through PR #1.

| Package | Version |
| --- | --- |
| react, react-dom | 19.3.1 |
| vite | 8.3.6 |
| @vitejs/plugin-react | 6.2.1 |
| typescript | 6.0.3 |
| tailwindcss, @tailwindcss/vite | 4.3.5 |
| eslint | 10.14.0 |
| @eslint/js | 10.0.1 |
| typescript-eslint | 8.72.1 |
| eslint-plugin-react-hooks | 7.1.1 |
| eslint-plugin-react-refresh | 0.5.7 |
| eslint-config-prettier | 10.1.8 |
| prettier | 3.9.10 |
| vitest | 5.1.0 |
| jsdom | 31.0.0 |
| @testing-library/react | 16.3.3 |
| @testing-library/jest-dom | 7.0.1 |
| @testing-library/user-event | 14.6.8 |
| @playwright/test | 1.65.0 |
| Node.js (local) | 24.19.0 |

## 2026-11-06 — Tooling on this machine
- **GitHub CLI (`gh`) is not installed.** Repo creation, settings, PRs, check polling and merges use the GitHub REST API directly, with the token held by Git Credential Manager (`git credential fill`). Each `gh` command in `CLAUDE.md` maps to its REST equivalent (`POST /user/repos`, `PATCH /repos/{o}/{r}`, `POST /pulls`, `PUT /pulls/{n}/merge`, etc.). Auto-merge is done by polling check runs and merging only when all are green, which is equivalent to `gh pr merge --squash --auto`.
- **Supabase CLI, Deno and Docker are not installed.** The Supabase CLI runs through `npx supabase`. Tests that need the local Supabase stack (RLS, SQL, Deno function tests) run in GitHub Actions, where Docker is available; CI is the gate for them.
- **npm runs from Git Bash**, because PowerShell's execution policy blocks `npm.ps1`.
- Git identity is repo-local: Thomas Cannon, GitHub noreply address (same as StatPadder).

## 2026-11-06 — Project location
- Project lives in personal OneDrive: `C:\Users\Thomas_Cannon\OneDrive\GitHub\airhead` (user requirement: nothing stored on the local machine outside OneDrive).
- `CLAUDE.md` at repo root; supplied `settings.json` placed at `.claude/settings.json` (project-level Claude Code settings).
