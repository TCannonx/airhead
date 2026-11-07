# Airhead — Implementation Plan for Claude Code

6 November 2026

## How to use this plan

This plan takes Airhead to **v0.1 (phases 1–4)** in small, tested tasks; phases 5–9 are outlined and get their own detailed plan after v0.1 has been used for a few weeks.

**Setup before the first session:**

1. Save the design doc and this plan in the repo as `docs/DESIGN.md` and `docs/PLAN.md`, alongside `docs/SETUP-GOOGLE-LOGIN.md` and `docs/MANUAL-CHECKLIST.md`.
2. Create two Supabase projects: `airhead-dev` and `airhead-live`. Create an Anthropic API key with a spend limit set in the Claude Console.
3. Install Node.js (current LTS), Git, the GitHub CLI (`gh auth login`), the Supabase CLI and Docker (for the local Supabase stack).

**Starter prompt for Claude Code:**

```text
Read CLAUDE.md, docs/DESIGN.md and docs/PLAN.md fully. We are building Airhead.
Work through PLAN.md one task at a time, in order, starting at the first unticked task.
For each task: write the failing tests first, implement until they pass,
run the full test suite and lint, then follow CLAUDE.md for branching,
pull requests and merging. Tick the task off in PLAN.md as part of its PR.
```

**Git and autonomy:** the repo's `CLAUDE.md` defines the GitHub workflow (branch per task, PR per task, automatic squash-merge when CI is green) and overrides the approval rules below. In particular, PRs are created and merged without asking; only the items in CLAUDE.md section 5 wait for the user, and those are recorded in `docs/BLOCKERS.md` rather than asked mid-flow. Wherever this plan says [ASK], treat it as "record in BLOCKERS.md and continue with other work".

**Working rules for Claude Code:**

- One task per PR; never start the next task with failing tests.
- Install the **current stable** version of every library and check its official docs; do not pin versions from memory. Note the versions used in `docs/DECISIONS.md`.
- Work against `airhead-dev` (or the local Supabase stack) only. Deploying to `airhead-live` happens only through a release tag (see CLAUDE.md).
- Never put secrets in client code or commit them; use `.env.local` (git-ignored) and Supabase secrets.
- Where this plan says **verify**, confirm the behaviour against current official docs before building on it, and record the finding in `docs/DECISIONS.md`.
- When the design doc and this plan disagree about what to build, record it in `docs/BLOCKERS.md`.

## Tech stack

Every library below is free and open source; install current stable versions and record them in `docs/DECISIONS.md`.

| Area | Choice | Notes |
| --- | --- | --- |
| App | React + TypeScript (strict) on Vite | Single-page PWA |
| PWA | vite-plugin-pwa (Workbox) | Offline app shell, install prompt, custom service worker for push |
| Routing | React Router | |
| Styling | Tailwind CSS | Light and dark themes; responsive phone, iPad, desktop |
| Local database | Dexie.js + dexie-react-hooks; MiniSearch (search); JSZip (export) | IndexedDB; the UI reads only from here |
| Validation | Zod | Shared schemas for local data, sync payloads and AI outputs |
| Dates | chrono-node, rrule, date-fns, date-fns-tz | Parsing, recurrence, time zones (Europe/Dublin default) |
| Calendar UI | FullCalendar standard (MIT) plugins: daygrid, timegrid, list, interaction, rrule | No premium plugins |
| Imports | ical.js, Papa Parse, SheetJS Community Edition, pdfjs-dist | SheetJS CE installs from its own CDN, not npm — verify current install route |
| Ink (phase 6) | perfect-freehand | |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions (Deno), Realtime, Cron (pg_cron + pg_net), Vault | Two projects: dev and live |
| AI | Anthropic SDK in Edge Functions only | Model IDs in config, e.g. `claude-haiku-5-5` (small), `claude-sonnet-5-5` (larger) — verify current IDs and prices |
| Link reading | @mozilla/readability + linkedom in Deno | Server-side extraction |
| Push | Web Push with VAPID keys | Use the `web-push` npm package from Deno, or a Deno-native Web Push library if it fails — verify |
| Tests | Vitest + Testing Library; Playwright for end-to-end; Deno test for functions | |
| Hosting | Cloudflare Pages (free) for the static app | Netlify is an equal alternative |
| CI and jobs | GitHub Actions | Tests on push; daily keep-alive ping; weekly database backup; dev deploy on merge; live deploy on tag |

## Repository structure

One repo holds the app, the Supabase project and the docs; pure logic lives in `src/lib` so it can be unit-tested without a browser.

```text
airhead/
  CLAUDE.md
  .claude/settings.json
  docs/            DESIGN.md, PLAN.md, DECISIONS.md, BLOCKERS.md, CHANGELOG.md,
                   SETUP-GOOGLE-LOGIN.md, MANUAL-CHECKLIST.md
  public/          icons, manifest assets
  src/
    app/           routes, layouts (phone tabs / iPad sidebar / desktop 3-pane)
    features/
      capture/     Capture tab, chips, paste, quick ink pad (phase 6)
      inbox/       Unsorted + To flesh out
      today/       brief, Top 3, Also today, suggestion cards
      library/     reading, ideas, notes, lists, search
      calendar/    FullCalendar views, event editor, import review
      work/        work location, leave, counter
      insights/    recaps, AI usage, stats
      settings/    all settings screens
    lib/
      db/          Dexie schema, repositories
      sync/        outbox, push, pull, realtime nudge
      rules/       link detection, date and recurrence parsing, confidence, learned rules
      holidays/    ie.ts (Irish public holidays), easter.ts
      leave/       working-day counting, leave year, balances
      calendar/    gap finding, ICS helpers
      schemas/     Zod schemas shared with functions
    sw/            custom service worker (push, notification click)
  supabase/
    migrations/    SQL migrations (schema, RLS, triggers, cron)
    functions/
      _shared/     ai.ts (gateway), auth.ts, cors.ts, prices.ts, prompts/
      ingest-capture/  read-link/  sort-batch/  scheduler-tick/
      send-push/  calendar-feed/  fetch-linked-calendars/  import-extract/
      health/
    seed.sql
  tests/e2e/       Playwright
  tests/fixtures/  ai/ (saved AI responses), html/, imports/
  .github/workflows/  ci.yml, deploy-dev.yml, release.yml, keepalive.yml, backup.yml
```

## Data model

Every synced table has the same sync columns and the same per-user security rule; the same shape is mirrored in Dexie on each device.

**Common columns on every synced table:** `id uuid` (generated on the device), `user_id uuid` (references `auth.users`), `created_at`, `updated_at` (device time, informational), `server_updated_at timestamptz` (set by a trigger to `now()` on every insert or update; the only value used for ordering), `deleted_at timestamptz null` (soft delete; a nightly job hard-deletes rows deleted more than 30 days ago).

**Security rule:** row-level security on every table; select, insert, update and delete allowed only where `user_id = auth.uid()`. Functions that serve feeds or Shortcuts use the service role and look up the user by a hashed token.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `settings` | One row per user | `data jsonb`: time zone, brief and review times, quiet hours, nudge cap, batch thresholds, AI monthly cap, work settings, location checklists |
| `devices` | Each installed device | `name`, `platform`, `push_subscription jsonb`, `receives_notifications bool`, `last_sync_at` |
| `capture_tokens` | Shortcut and bookmarklet tokens | `token_hash`, `label`, `revoked_at` |
| `captures` | Raw inputs, never altered by AI | `kind` (text, link, ink, image, import), `text`, `url`, `payload jsonb`, `source` (app, shortcut, bookmarklet), `status` (unsorted, sorted, needs_review, failed), `captured_at`, `sorted_at` |
| `items` | Everything captures become | `capture_id`, `type` (task, event, reading, idea, meeting, note, list_entry), `title`, `body`, `data jsonb`, `status`, `due_at`, `start_at`, `end_at`, `all_day`, `rrule`, `calendar` (personal, us), `series_id`, `list_id`, `topic_ids uuid[]`, `confidence`, `top3_date`, `carry_count`, `completed_at` |
| `lists` | Personal lists | `name`, `sort_order` |
| `topics` | Tags for ideas and notes | `name` |
| `corrections` | User re-sorts, reused as examples | `capture_id`, `from jsonb`, `to jsonb` |
| `series` | Imported schedules | `name`, `color`, `source_path`, `feed_id` |
| `nudges` | Scheduled notifications | `item_id`, `kind`, `send_at`, `title`, `body`, `status` (scheduled, sent, cancelled, failed), `sent_at`, `acted_at` |
| `feeds` | Calendar links | `kind` (us_out, me_out, linked_in), `name`, `color`, `url` (linked_in only) or `token_hash` (us_out, me_out), `last_fetched_at`, `last_error` |
| `external_events` | Events read from linked feeds | `feed_id`, `uid`, `title`, `start_at`, `end_at`, `all_day`, `location` |
| `work_days` | Location overrides | `date`, `location` (wfh, office, client, travel, off) |
| `leave_bookings` | Annual and other leave | `leave_type`, `start_date`, `end_date`, `start_half`, `end_half`, `status` (planned, requested, approved, taken, cancelled), `days numeric`, `share_to_us bool` |
| `ai_usage` | One row per AI call (not synced to devices; read via a view) | `task`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_eur`, `ok bool` |
| `ai_prices` | Editable price table | `model`, `input_per_mtok`, `output_per_mtok`, `cache_read_per_mtok`, `eur_rate` |

**Memory tables (phase 3):** `memory_facts` (`text`, `category` (everyday, person, personal), `status` (active, pending_approval, archived), `source_capture_id`, `last_used_at`) and `learned_rules` (`pattern`, `match_kind` (prefix, keyword), `result jsonb` (type, list, calendar), `hits`, `enabled`). Both are synced and covered by the same security rule.

Public holidays are computed on the device and are not stored. Default work location comes from the weekly pattern in `settings`; `work_days` only stores exceptions.

## Conventions

These rules apply to every task; they keep AI costs visible, user data safe and the app working offline.

**AI calls**

- Only `supabase/functions/_shared/ai.ts` talks to the Anthropic API. Signature: `callAI({ task, tier: 'small' | 'large', system, messages, schema })`.
- It maps tier to model from config, forces structured output by tool use with a JSON schema, validates the result with Zod, retries once on invalid output, and writes an `ai_usage` row (tokens and cost in euros from `ai_prices`) for every call, successful or not.
- It checks the monthly cap first; when reached, background tasks return `cap_reached` and leave work queued. On-demand tasks show the user the cap message.
- Long fixed system prompts use prompt caching. Prompts live in `_shared/prompts/` as versioned files.
- No call ever sends the whole database: each task builds a compact digest with SQL.

**Untrusted content**

- Web pages, imported files, linked calendars and capture text are wrapped in clearly delimited content blocks with an instruction that they are data, not instructions.
- Anything derived from untrusted content (actions in a link, events in an import) is created as a suggestion or a review row, never applied automatically.
- `read-link` and `fetch-linked-calendars` fetch only `http`/`https` URLs, reject private and local IP ranges, follow at most 3 redirects, time out after 10 seconds and cap downloads at 2 MB.

**Errors and offline**

- Saving to Dexie never waits on the network. Every network failure leaves the work queued and retried with backoff; the sync status icon reflects it.
- Functions return `{ ok, error_code, message }`; the UI shows plain-language messages, never stack traces.

**No hidden commands**

- Every feature is reachable from a visible button or menu. Keyboard shortcuts on desktop only speed up actions that already have a button; there are no slash commands or typed commands.

**Testing**

- Pure logic in `src/lib` gets unit tests first: rules, holidays, leave, sync merge, gap finding.
- AI tasks are tested against saved fixture responses in `tests/fixtures/ai/`; tests never call the paid API.
- Row-level security gets a test that a second test user cannot read or write the first user's rows.
- Each phase ends by updating `docs/MANUAL-CHECKLIST.md` with device checks for iPhone, iPad and desktop Chrome.

**Time**

- Store timestamps in UTC; compute days, holidays and leave in the user's time zone (default `Europe/Dublin`). Date-only values (leave, holidays, work days) are stored as `date`, never as timestamps.

## Phase 1: Foundations

Goal: an installable, signed-in, empty app shell on iPhone, iPad and desktop Chrome, deployed from CI, with dev and live projects and the free-plan safeguards in place.

- [x] **1.1 Scaffold the repo.** Vite + React + TypeScript (strict), Tailwind, ESLint, Prettier, Vitest, Testing Library, Playwright; folders as in Repository structure; `docs/DECISIONS.md`, `docs/BLOCKERS.md` and `docs/CHANGELOG.md` created. Create the GitHub repo and configure it as described in CLAUDE.md section 2.
    - Done when: `npm run dev` serves the app; `npm test`, `npm run lint` and `npm run typecheck` pass.
- [x] **1.2 PWA shell.** vite-plugin-pwa with the injectManifest strategy and a custom service worker in `src/sw/`; manifest (name Airhead, standalone display, theme colours, placeholder icons including Apple touch icon); offline app shell caching. Verify current iOS home-screen requirements.
    - Test: Playwright loads the app, goes offline, reloads, and still sees the shell.
    - Done when: installs to the home screen on iPhone and iPad and as an app window in desktop Chrome.
- [x] **1.3 Responsive layout skeleton.** Routes: Capture, Today, Inbox, Library, Insights, Settings. Phone (< 768 px): bottom tabs. iPad (768–1279 px): sidebar plus main pane. Desktop (≥ 1280 px): sidebar, main pane, right panel. Light and dark themes; iOS safe-area insets.
    - Test: component tests render the right navigation at each width.
- [x] **1.4 Supabase setup and first migration.** _(Linking `airhead-dev` waits on the user: see BLOCKERS.)_ `supabase init`, local stack, link `airhead-dev`. Migration `0001`: trigger function setting `server_updated_at = now()`, the `settings`, `devices` and `capture_tokens` tables, RLS policies as in Data model.
    - Test: an RLS test creates two users and proves user B cannot read or write user A's rows.
- [x] **1.5 Sign-in.** _(Built and tested with fakes; real sign-in on the three devices waits on the Supabase projects and Google client: see BLOCKERS.)_ Supabase Auth with Google as a login only (openid, email, profile scopes; no calendar scopes) plus email magic link as a fallback; persistent session; sign-out. The user follows `docs/SETUP-GOOGLE-LOGIN.md` to create the OAuth client [ASK]; build and test with magic link meanwhile.
    - Done when: sign-in works on all three devices and a `devices` row is registered for each.
- [x] **1.6 App lock.** Optional, set in Settings: register a WebAuthn platform credential (Face ID or Touch ID); show a lock screen on open and after a chosen inactivity time-out. Document that it is a privacy screen, not encryption; signing out and back in is the recovery path.
    - Test: unit tests for time-out and lock-state logic.
- [x] **1.7 Hosting.** _(Repo side done; connecting Pages waits on the user: see BLOCKERS.)_ Cloudflare Pages builds from the main branch with SPA fallback, per-PR previews and environment variables for the dev project. The user connects Pages to the repo [ASK]. Live deployment happens only from a release tag.
- [x] **1.8 CI and safeguards.** _(Branch protection needs GitHub Pro on a private repo, and the deploy workflows need the user's secrets: see BLOCKERS.)_ `ci.yml` runs lint, typecheck and unit tests on every push and PR. `deploy-dev.yml` runs `supabase db push` and `supabase functions deploy` against dev on merge to main. `release.yml` deploys a `v*` tag to live. A `health` function plus `keepalive.yml` calls both projects daily. `backup.yml` runs `supabase db dump` weekly for live and keeps it as a workflow artifact. Set branch protection on main as in CLAUDE.md once CI has run. The user adds the secrets [ASK].
    - Done when: CI is green and a manual run of each workflow succeeds.

## Phase 2: Capture core and sync

Goal: capture anything offline, see links and clear dates handled instantly by free rules, and have iPhone, iPad and desktop stay in sync.

- [x] **2.1 Core tables.** Migration `0002`: `captures`, `items`, `lists`, `topics`, `corrections`, with sync columns, RLS, indexes on `(user_id, server_updated_at)`, Realtime enabled. A `pg_cron` job hard-deletes rows soft-deleted more than 30 days ago. Storage bucket `captures` with a policy limiting paths to `<user_id>/...`.
    - Test: RLS test extended to the new tables.
- [x] **2.2 Local database.** Dexie schema mirroring the synced tables plus an `outbox` table and a `sync_state` table (per-table cursor). Zod schemas in `src/lib/schemas` shared with functions. Request persistent storage on first run.
- [x] **2.3 Sync engine.** Every local write goes to its table and the outbox in one Dexie transaction. Push: drain the outbox in batches of 100 via upserts. Pull: per table, rows with `server_updated_at > cursor`, pages of 500, applied in order (server order wins). Triggers: app open, `online` event, after each capture, every 60 s while visible, and a Supabase Realtime message on the user's channel.
    - Tests: unit tests for outbox ordering, merge and soft-delete handling; an end-to-end test that captures offline, reconnects and sees the item on a second browser context.
- [x] **2.4 Capture tab.** Autofocused text box (Enter saves on desktop, a Save button on touch); a Paste button when the clipboard holds a URL (read only on tap); optional photo attach compressed on device (longest side 1600 px, WebP) and queued for upload. Each capture shows a status chip.
- [x] **2.5 Free rules.** In `src/lib/rules`: URL detection → capture kind `link` and a `reading` item; date parsing with chrono-node's British-English parser so "3/4" means 3 April; a confidence rule (explicit date, explicit time or all-day wording, in the future, no fuzzy words such as "ish", "sometime", "maybe"); a recurrence parser producing RRULEs for common phrases.
    - Tests: a table of at least 30 phrases with expected results, including "dentist Tue 3pm", "brunch Saturday 11", "training Tues and Thurs 7pm", "John's birthday 14 March", "call Mark tomorrow", "sometime next week" (fuzzy), "3/4 meeting".
- [x] **2.6 Instant events and suggestions.** Confident dates create an `event` item on the Personal calendar with an 8-second undo toast; fuzzy ones create a suggestion card. Works fully offline.
- [x] **2.7 Inbox and Library (basic).** Inbox: Unsorted and To flesh out sections. Library: tabs by type with filters by topic, date and type; item detail and edit; manual re-sort that records a `corrections` row; Trash view with restore for 30 days.
- [x] **2.8 On-device search.** MiniSearch (MIT) index over item titles, bodies and capture text, rebuilt incrementally; a visible search box in Library (and `/` as a desktop shortcut to it).
- [x] **2.9 Export everything.** Settings → Export builds a zip (JSZip) with one Markdown file per item plus a full JSON dump of all tables.
    - Test: export then parse the JSON back and compare row counts.
- [x] **2.10 Sync visibility.** Status icon (synced, "n waiting", offline) and last successful sync time in Settings.
- Phase done when: the Phase 2 lines of the manual checklist pass on all three devices.

## Phase 3: AI sorting, link reading, lists and AI usage

Goal: unsorted captures are sorted, split and tagged in cheap rolling batches; links are read and summarised; memory makes calls tailored and cheaper; every AI cent is visible.

- [x] **3.1 AI gateway.** Migration `0003`: `ai_usage`, `ai_prices` (seed current prices — verify), and a user-scoped view for usage. `_shared/ai.ts` as described in Conventions (tier → model, tool-use JSON output, Zod validation, one retry, usage row, cap check, prompt caching).
    - Tests: mocked API responses for success, invalid JSON then success, invalid twice, API error and cap reached; each writes the right usage row.
- [x] **3.2 Sort batch.** Function `sort-batch`: takes up to 20 unsorted captures for one user, oldest first. Context digest: current time and time zone, topic names, up to 30 active idea titles, list names, the last 5 corrections. Output per capture: an array of items, each with `type`, `title`, optional `body`, dates, `rrule`, `list_name`, `topics`, `confidence` (0–1), `suggest_workshop`, optional related idea. Apply in one transaction: insert items; events follow the same confidence rule as the free rules (confident → created, otherwise suggestion card); captures become `sorted`, or `needs_review` when any item's confidence is below 0.6.
    - Tests: fixture-based, covering a brain dump that splits into a task, an event and a shopping list entry; an ambiguous capture going to review; a new topic being created.
- [x] **3.3 Batch triggers.** Client calls `sort-batch` on app open when unsorted captures exist and from a "Sort now" button. A `pg_cron` job every 5 minutes uses `pg_net` to call `sort-batch` for users with at least the threshold count (default 5) or an oldest unsorted capture older than the threshold age (default 60 minutes). The service key is stored in Vault. Thresholds come from `settings`.
- [x] **3.4 Review and corrections.** Low-confidence items appear in Inbox with one-tap choices ("Task or Idea?"); any re-sort records a correction that feeds the next batch's examples.
- [x] **3.5 Link reading.** Function `read-link`, called after a link capture syncs: safe fetch (Conventions), readability extraction, store title, description, word count and reading minutes, plus up to 3,000 words of article text in the capture payload. The next sort batch writes the summary, key points, topics and any suggested actions; the stored article text is then cleared. Unreadable pages fall back to title and description with a "couldn't read" flag.
    - Tests: saved HTML fixtures for an article, a paywalled page and an event page; SSRF tests for private IPs and redirects.
- [x] **3.6 Lists.** Library → Lists: create, rename, reorder, tick off, clear completed; a default Shopping list. Sorting puts list entries on existing lists; an unknown list name goes to review as "Create list 'Packing'?".
- [x] **3.7 AI usage screen.** Insights → AI usage: month to date by task, a daily bar chart, projected month-end (month to date ÷ days elapsed × days in month), monthly cap setting, editable price table, and the note that the provider dashboard is the true record. A helper returns an estimate for on-demand buttons (average of the last 10 calls for that task, or a default).
- [x] **3.8 Success measures.** Insights shows captures per day, sorting correction rate (corrections ÷ items sorted, last 30 days) and AI cost per month.
- [x] **3.9 Memory and learned rules.** Migration adds `memory_facts` and `learned_rules`. `sort-batch` output gains optional `proposed_facts` (text plus category); everyday facts become active, person and personal facts become `pending_approval` and show as one-tap cards. Facts are only accepted from user-typed captures, never from link text, imports or linked calendars. The core profile (active facts, capped at about 400 words, most recently used first) is placed in the cached prompt prefix; `last_used_at` updates when sent. Settings → "What Airhead knows about me" lists, edits, deletes and adds facts. A nightly job archives facts unused for 180 days. Learned rules: after the same pattern has been sorted to the same result at least 4 times with no correction, create a rule; the on-device rules engine applies enabled rules before queuing for AI; Settings lists rules with on/off switches; a correction against a rule disables it.
    - Tests: fact categorisation and approval routing from fixtures; injected "remember that…" text inside link content creates no fact; rule creation threshold and disabling on correction.
- [x] **3.10 Memory Check-up.** "Run check-up" button in Settings → Memory and in Insights. Code checks: core profile size and words per call, near-duplicate facts (normalised text similarity), facts unused for 90+ days, pending approvals, rules with low hits or repeated corrections, average input tokens per AI task over the last 30 days against the previous 30, storage, sync and cost trends. A "Check for contradictions" button runs one small-tier call. Each finding has a one-tap fix (merge, archive, delete, disable) and an estimated saving. A monthly code-only run posts its report to Insights.
    - Tests: unit tests for each check with seeded data; the saving estimate uses the current price table.
- Phase done when: a day of real captures is sorted with no manual trigger and the AI usage screen matches the Claude Console within rounding.

## Phase 4: Calendar, sharing, work and leave, import, notifications

Goal: a full calendar on every device, shared with my girlfriend by feed, Irish holidays and leave tracking, schedule imports, and reliable iPhone notifications.

**Calendar**

- [x] **4.1 Calendar tables.** Migration `0004`: `series`, `nudges`, `feeds`, `external_events`, `work_days`, `leave_bookings`, plus `job_runs (user_id, job, local_date)` with a unique key so scheduled jobs never run twice.
- [x] **4.2 Calendar views.** FullCalendar with daygrid, timegrid, list, interaction and rrule plugins. Day, week, month and agenda views (agenda is the phone default). Sources: Personal and Us events, linked external events (read-only), public holidays, leave, and a work-location badge on each day; colour per source with show/hide toggles. Drag and resize to reschedule; drag a task from the task list onto the calendar to time-block it; click an empty slot to create; editor in a side panel on desktop and a sheet on phone.
    - Tests: unit tests for the event-source mapping; Playwright for create, drag to reschedule and time-blocking.

**Work and leave**

- [x] **4.3 Irish public holidays.** `src/lib/holidays/ie.ts` and `easter.ts` (Gregorian computus). Rules from the design doc; St Brigid's Day only from 2023. Good Friday, Christmas Eve and New Year's Eve are returned as optional "common days off", not holidays. Manual one-off holidays from settings are merged in.
    - Tests: St Brigid's Day 2023-02-06, 2024-02-05, 2025-02-03, 2026-02-02, 2027-02-01, 2030-02-01 (a Friday); Easter Monday 2026-04-06 and 2027-03-29; October holiday 2026-10-26; no St Brigid's Day in 2022.
- [x] **4.4 Work settings.** Settings → Work: working days, hours per day, leave year start (default 1 December), entitlement, carry-over maximum and expiry, how a weekend public holiday is compensated (day off within a month, extra leave day, extra pay), whether closure days use leave, closure days, leave types (deducting or not), default weekly location pattern, a checklist per location.
- [x] **4.5 Leave engine.** `src/lib/leave`: leave-year boundaries, working-day counting with half days (skipping weekends, non-working days, public holidays and, if set, closure days), balances (entitlement + carry-over, taken, booked, planned, remaining), the extra day when a weekend holiday is compensated with leave, and a pace figure.
    - Tests: bookings crossing the December year boundary and Christmas, half days, a booking spanning a public holiday, carry-over expiry, at least 25 cases.
- [x] **4.6 Leave UI.** Select a range on the calendar → "Book leave" sheet (type, half days, status, share to Us). Capture rule for phrases like "AL 14–18 July" proposes a booking. Leave days set location to Off and silence work nudges. A nightly job marks past bookings Taken. Leave counter on Today and in the Work screen.
- [x] **4.7 Work location.** Today chip with one-tap change, desktop control, calendar badge; Insights shows days per location by week and month.

**Sharing**

- [x] **4.8 Outgoing feeds.** `feeds` rows of kind `us_out` (Us calendar) and `me_out` (everything, for my own iPhone). Tokens are 32 random bytes; only a SHA-256 hash is stored, the URL is shown on creation and on regenerate. Function `calendar-feed?t=<token>` returns a valid iCalendar file with stable UIDs, recurrence rules, Us events, shared leave as all-day "Off", and work location per the sharing setting ("WFH"/"Office" or just "Working"). Offer `webcal://` and copy-link buttons.
    - Tests: round-trip the output through ical.js; a revoked token returns 404.
- [x] **4.9 Linked calendars.** Settings → Linked calendars: paste a secret iCal URL, validate by fetching and parsing, name and colour it. A `pg_cron` job every 30 minutes calls `fetch-linked-calendars`: safe fetch, parse, expand recurrences 12 months ahead, upsert by UID, remove events no longer present, record errors on the feed.

**Import schedule**

- [x] **4.10 Import flow.** Calendar → Import: file, paste or link, plus an instruction box. On device: .ics via ical.js; CSV and Excel via Papa Parse and SheetJS with a column-mapping step; PDF text via pdfjs-dist. Messy text, scanned PDFs and images go to `import-extract` (one AI call, vision for images) with the instruction. Review table of proposed events (ticked, editable), choose Personal or Us, name the series, save. Unconfirmed times become all-day "time TBC" with a check-nearer-the-date nudge; clashes are flagged; events on working days offer a leave booking; an .ics URL can be added as a linked calendar instead. The original file is stored with the series.
    - Tests: fixtures for .ics, CSV, a text PDF and a screenshot (AI fixture), including an "only home games" instruction.

**Notifications**

- [x] **4.11 Push setup.** VAPID keys as secrets. Settings → Notifications: an enable button (permission is requested only on tap); on iPhone, detect when the app is not installed to the home screen and explain how. Store the subscription on the device row; the first device enabled is marked `receives_notifications`, iPhone by default. `send-push` sends via Web Push and clears subscriptions that return 404 or 410. The service worker shows notifications and opens the linked screen on tap. A "Send test notification" button.
- [x] **4.12 Reminder generation.** A database trigger on `items` creates, updates or cancels nudges: event reminder (30 minutes before by default, per-event override), task due reminder, and cancellation on delete or completion. Because it runs in the database, reminders are scheduled once the item has synced.
    - Tests: SQL tests for create, move and complete.
- [x] **4.13 Scheduler tick.** `pg_cron` every minute calls `scheduler-tick`, which: sends due nudges, deferring those in quiet hours (event reminders can be allowed through) and bundling anything over the daily cap into one summary notification; runs per-user local-time jobs guarded by `job_runs`: evening review, location checklist the evening before, leave run-out checks (about 90, 42 and 14 days before the leave year ends, when remaining days exceed carry-over), the slip nudge for tasks carried over 3 or more times, and marking leave Taken.
    - Tests: Deno tests with a fixed clock for quiet hours, cap bundling, time zones and duplicate-run protection.
- [x] **4.14 Evening review.** The notification opens a screen to tick off, carry over or drop today's open tasks; carrying over increments `carry_count`.
- [x] **4.15 Notification settings.** Per-type toggles, quiet hours, daily cap, reminder default, per-device toggle.
- Phase done when: the Phase 4 manual checklist passes, including a real notification on the iPhone and my girlfriend seeing the Us calendar in her app.

## v0.1 acceptance checklist

v0.1 is done when every box below is ticked on real devices; then release to `airhead-live` with a `v0.1.0` tag and use it daily for a few weeks before planning phases 5–9.

- [ ] Installs and opens offline on iPhone, iPad and desktop Chrome; app lock works.
- [ ] A capture made in airplane mode appears on the other two devices within a minute of reconnecting.
- [ ] A link is read and summarised; a paywalled link is marked "couldn't read".
- [ ] "Dentist Tue 3pm" creates an event instantly offline with undo; "sometime next week" becomes a suggestion.
- [ ] A five-item brain dump is split correctly, including a shopping list entry.
- [ ] Correcting a sort once changes how a similar capture is sorted next time.
- [ ] Week view on desktop: drag a task onto Thursday 2pm and drag an event to Friday.
- [ ] Irish public holidays for the current and next year match Citizens Information.
- [ ] Booking 5 days of leave over a public holiday deducts 4; the counter and run-out reminder are correct for a December–November leave year.
- [ ] My girlfriend sees Us events and my shared leave in her calendar app; her linked calendar's events show in Airhead.
- [ ] A fixtures PDF with "attending all home games" imports as a reviewed series.
- [ ] An event reminder, a location checklist and the evening review arrive on the iPhone only, respecting quiet hours.
- [ ] AI usage screen totals match the Claude Console; a test cap pauses background sorting.
- [ ] Export produces a readable zip; RLS tests pass; the weekly backup artifact exists.
- [ ] An everyday fact is added to memory automatically; a fact about a person waits for one-tap approval; a "remember this" line inside a web page creates nothing.
- [ ] After four uncorrected "buy …" captures, a learned rule sorts the fifth instantly offline.
- [ ] Run check-up finds a planted duplicate fact and a stale fact, and fixes both in one tap each.

## Phase 5: Today and morning brief

Goal: one calm daily list. Each morning one large-tier AI call turns a SQL-built digest into a short brief, a Top 3 with suggested time slots (found in free calendar gaps by code), an "Also today" list and prep nudges. If the call fails, a code-built list goes out instead. Planned in detail on 2026-11-07 from `DESIGN.md` (see DECISIONS).

- [x] **5.1 Brief table.** Migration: `briefs` (`user_id`, `local_date`, `status` ok / fallback, `content` jsonb, `model`, `cost_eur`), one per person per day, synced to devices read-only like `external_events`. Zod schema, Dexie table, sync.
    - Tests: pgTAP for RLS (owner reads, devices can't write) and one brief per day.
- [x] **5.2 Digest.** SQL `morning_digest(user_id, local_date)` returns compact JSON:
    - today's and the next 7 days' events, including linked calendars, leave, holidays and today's location;
    - open tasks with due dates, carry counts and current Top 3;
    - yesterday's numbers (done, carried over, captured);
    - up to 10 active ideas.

    Titles only, no notes, so the call stays small.
    - Tests: pgTAP with seeded data (time zones, deleted rows left out, size limits).
- [x] **5.3 Free slots.** Shared code (device and server) that finds free gaps in a day from timed events, inside a day window (work hours on working days, a wider window on days off), and fits each Top 3 task into the earliest gap of its estimated length (15 to 120 minutes), e.g. "Dentist call fits 12:30–12:45".
    - Tests: unit tests for overlaps, edges, all-day events, no room, and the clock-change day.
- [x] **5.4 Morning brief function.** `morning-brief` (large tier, prompt `brief.v1`, structured output). From the digest it returns:
    - a two- or three-line reflection on yesterday;
    - a Top 3 (item ids from the digest only, a reason and minutes each);
    - "Also today" ids;
    - up to 3 prep nudges with local send times.

    Code validates ids and times, adds the slots (5.3), writes the brief, sets `top3_date` on the chosen tasks, writes prep nudges (`kind = 'prep'`, with keys) and sends the round-up notification. Uses the large-tier refusal fallback (verify the current API option). If AI fails or the cap is reached, it falls back to the code-built list (5.5).
    - Tests: Deno with AI fixtures (a normal day, invented ids dropped, a refusal or cap leading to the fallback), and prompt checks (digest marked as data).
- [x] **5.5 Fallback list.** Code-only Top 3 and Also today:
    - overdue, then due today, then the most carried over, then oldest;
    - events and leave listed; no reflection.

    Used by 5.4 on failure and shown on the device when no brief exists yet (offline).
    - Tests: unit tests for the ordering and ties.
- [x] **5.6 Scheduling the brief.** A once-a-day `morning_brief` job in the scheduler tick at the chosen time (default 07:30; `settings.data.notifications.brief_time`), running the brief in the same function. A new notification type "Morning round-up" with its own switch. Skipped on a day with nothing to say (no tasks or events).
    - Tests: Deno tick tests (time zone, once a day, switched off).
- [x] **5.7 Today tab.** In order:
    - the brief's lines;
    - today's events (Airhead, linked, holidays, leave) and the location chip;
    - **Top 3** shown prominently with suggested slots ("Block 12:30–12:45" sets the task's time) and done checkboxes;
    - collapsed **Also today**;
    - suggestion cards (fuzzy events, leave proposals, carry-over prompts from 5.8);
    - leave counter.

    With no brief yet, the fallback list (5.5) is computed on the device. The desktop right panel shows the same Top 3 and next events (today at a glance).
    - Tests: component tests with a brief, without one, and offline.
- [x] **5.8 Top 3 and carry-over prompts.** Add to or remove from today's Top 3 from Today and from any task (at most 3; a fourth asks which to swap). In the morning, cards for yesterday's unfinished Top 3 and due tasks: Done, Today, or Drop (Today increments `carry_count`, as the evening review does).
    - Tests: unit and component tests.
- [x] **5.9 Brief settings and Regenerate.** Settings → Today: brief on or off, its time, the day window for slots, and a **Regenerate brief** button (online only, with its cost estimate, counted in AI usage).
    - Tests: component tests (settings saved, cost line shown, button disabled offline).
- Phase done when: the Phase 5 manual checklist passes (a brief arrives at the chosen time with sensible slots; a failed call still sends the fallback list).

## Phase 6: Notes

Goal: meeting notes in two styles, typed and handwritten (stage 1), saved instantly, synced as whole documents without ever losing writing, then summarised once into a summary, decisions and action items you confirm into tasks. Planned in detail on 2026-11-07 from `DESIGN.md` (Notes; Offline and sync).

- [x] **6.1 Note documents.** Migration: `note_docs` (id = the note item's id, `kind` typed or ink, `doc` jsonb, `version`, `base_version`, `summary` jsonb), synced both ways with own-rows RLS. A note or meeting item points at its document. A server trigger bumps `version` on each write.
    - Tests: pgTAP (RLS, version bump), Zod schema and Dexie table.
- [x] **6.2 Conflict copies.** When a pull brings a newer version of a document that also has unsynced local changes, keep both: the local text becomes a new note titled "… (conflicted copy, <device> <time>)" and the server version is applied. Writing is never silently discarded. Applies to note documents only; other tables stay newest-wins.
    - Tests: sync engine unit tests (no conflict, conflict, a conflict while offline then two edits).
- [x] **6.3 Typed notes.** A keyboard-first editor (TipTap starter kit, MIT; verify the current version): headings, bullets, numbered lists, checkboxes, bold and italic, and Markdown-style shortcuts. Saved locally on each change (debounced); a whole-document push a few seconds after typing pauses. "New note" and "New meeting note" in the Library and Capture.
    - Tests: component tests (create, type, reopen, debounce saves).
- [x] **6.4 Meeting details.** Title, date and attendees on a meeting note. "Start notes" on an event (Today and the calendar editor) creates a meeting note linked to it, with the event's title and time. The event shows a link to its notes.
    - Tests: component tests.
- [x] **6.5 Handwritten page.** A fixed-width page that scrolls and grows as you write, drawn with perfect-freehand (MIT).
    - Apple Pencil (pointer type pen) draws and fingers scroll; on desktop the mouse can draw too.
    - Toolbar: pen in a few colours and two widths, highlighter, stroke eraser, undo and redo.
    - Strokes are stored as compact point data (rounded, delta-encoded) in the document, not images.
    - Tests: unit tests for stroke encoding and decoding, hit-testing for the eraser and the undo stack; a Playwright check that a drawn stroke survives a reload.
- [x] **6.6 Text boxes.** Tap with the text tool to add a quick text label on a handwritten page; move, edit, delete. Stored in the same document.
    - Tests: unit and component tests.
- [x] **6.7 Summarise.** "Done → Summarise", one large-tier call with prompt `summarise.v1`:
    - Handwritten pages are rendered to images on the device (vision); typed notes are sent as text.
    - Returns a transcription (ink), a short summary, decisions and action items (title, owner if mentioned, due if mentioned).
    - Stored once on the document; the transcription and summary are added to search.
    - Online only, with its cost estimate. The note is data, never instructions.
    - Tests: Deno with AI fixtures (typed; ink with a transcription; an injection line inside the note does nothing), and output validation.
- [x] **6.8 Action items to tasks.** After Summarise, a checklist of proposed action items, all unticked. Confirmed ones become tasks linked to the note, with due dates parsed by the free rules. Nothing is created without a tap.
    - Tests: component tests.
- [x] **6.9 Notes in the Library.** Meetings and Notes tabs list documents. Opening a summarised note shows the summary, decisions and action items above the original (typed text or the pages, view-only on phone and desktop, editable on iPad). Search covers titles, typed text, transcriptions and summaries.
    - Tests: component tests and search tests.
- Phase done when: the Phase 6 manual checklist passes (write on the iPad with the Pencil, fingers scroll, it syncs, it summarises, actions become tasks, and a conflicted copy appears when both devices edit offline).

## Phase 7: Thinking tools

Goal: capture from anywhere (iOS Shortcuts and a Chrome bookmarklet), think ideas through in the Workshop (auto flesh-out and collaborative sessions with versions), and ask questions of everything with cited answers (Ask Airhead). Planned in detail on 2026-11-07 from `DESIGN.md` (Capture; AI; Memory; Scout and Check-up; Desktop).

- [x] **7.1 Capture tokens.** Migration `capture_tokens` (id, user_id, name, `token_hash` sha-256, created_at, last_used_at, revoked_at), own-rows RLS for reading and revoking. The token itself is never stored or synced. Settings → Capture from anywhere: create a named token (shown once, with Copy), list tokens with their last use, and revoke one.
    - Tests: pgTAP (RLS, a revoked token stays revoked), component tests.
- [x] **7.2 `ingest-capture`.** A function taking `Authorization: Bearer <capture token>` (looked up by hash with the service role; revoked or unknown tokens give 401). The body is `{ text?, url?, image? (base64, at most 5 MB), source: 'shortcut' }`. It inserts an Unsorted capture exactly as sent (data, never instructions) and updates `last_used_at`. Rate limit: 60 captures per token per hour. Plain-text replies ("Saved to Airhead.") for the Shortcut to show.
    - Tests: Deno (valid, revoked, oversized, rate limited, text and link and image), pgTAP for the lookup function.
- [x] **7.3 iOS Shortcuts.** `docs/SETUP-SHORTCUTS.md` plus an in-app guide on the same Settings page, with click-by-click steps:
    - **Send to Airhead**: share sheet, for links, text and images.
    - **Quick thought**: Back Tap or the Action Button, dictated or typed.
    - Both use "Get contents of URL" with the token. When the request fails, the Shortcut says to open the app and capture offline.
    - Tests: a docs check that the guide names the function URL pattern and never contains a real token.
- [x] **7.4 Bookmarklet and share target.** "Send to Airhead" bookmarklet: a link to drag to the bookmarks bar. It opens Airhead's own `/share?url=&title=&text=` page in a small window, and the signed-in app saves the capture there. No token goes into web pages, so a page's scripts can never read it. The same route becomes the PWA manifest's `share_target` (Android and desktop Chrome).
    - Tests: component tests for `/share` (saves once, shows Saved, closes), and a unit test for the bookmarklet code (encodes the selection, the title and the URL).
- [x] **7.5 Workshop data.** Migration:
    - `drafts`: id, item_id, version, `content` jsonb with summary, sections [{heading, body}], open_questions and next_steps; `source` auto, session or edit. Append-only versions.
    - `workshop_sessions`: id, item_id, `turns` jsonb [{role, text, at}], `pending` answer.
    - Both are synced both ways with own-rows RLS. An item is "in the Workshop" via `data.workshop = true`, set from any item, or from sorting's existing Workshop suggestion with one tap. The Inbox "To flesh out" section lists these items.
    - Tests: pgTAP (RLS, version uniqueness), Zod and Dexie.
- [x] **7.6 Auto flesh-out.** Function `workshop`, mode `flesh_out`: one large-tier call with prompt `fleshout.v1`. It gets the item, its links' text and the relevant memory facts, and returns the structured draft. That draft is saved as a new version. The draft view shows the newest version, older versions are one tap away, and it links to the original. Online only, with its cost estimate.
    - Tests: Deno with AI fixtures (valid draft, schema failure retried once, an injection line in a linked page does nothing), component tests for versions.
- [x] **7.7 Work on it together.** Mode `turn`: it sends only the current draft and the last 6 turns plus the new answer. It returns two or three questions and an updated draft (a new version). Answers typed offline wait in `pending` and are sent when back online. A session can be left and resumed.
    - Tests: Deno (only the recent turns are sent), component tests (offline answer queued, then sent).
- [x] **7.8 Next steps to tasks.** A draft's next steps become tasks in one tap: a checklist, all ticked by default (the user is already deciding in the Workshop), with "Add N tasks". Each task is linked to the idea (`data.idea_id`) and its due text is read by the free rules (reuses `actionsToTasks`).
    - Tests: component tests.
- [x] **7.9 Embeddings.** **Verify** Supabase's built-in model: `gte-small` via `Supabase.ai.Session('gte-small')` with `mean_pool` and `normalize`, English, input cut at 512 tokens. Its dimension is expected to be 384; confirm it against a real embedding and record it.
    - Migration `chunks`: id, user_id, item_id, chunk_index, content, `content_hash`, `fts` (generated tsvector), `embedding vector(384)`. HNSW index with `vector_ip_ops`, GIN on `fts`, own-rows RLS for reading only.
    - Function `embed-items`, run by the scheduler through `claim_job`, chunks changed items into about 300-word chunks: title, body, typed note text, summary, transcription and Workshop drafts. It embeds only chunks whose hash changed and removes the chunks of deleted items.
    - Tests: Deno (chunking, hash skip, deletes; the embedder is injected), pgTAP (RLS).
- [x] **7.10 Ask Airhead.** SQL `hybrid_search(query_text, query_embedding, match_count)`: security invoker, own rows only. It runs full-text (`websearch_to_tsquery`) and vector search, merged by reciprocal rank fusion (k = 50).
    - Function `ask`: embeds the question, takes the top 8 passages and makes one call (small tier by default; Settings can choose large) with prompt `ask.v1`. Passages are data, never instructions.
    - It returns an answer with citations restricted to the passages it was given.
    - Library → Ask: online only, with its cost estimate. Each citation taps through to its item or note. Offline, it says to use search.
    - Tests: pgTAP (hybrid ranking, RLS), Deno with fixtures (citations outside the passages are dropped, an injection passage does nothing), component tests.
- [x] **7.11 Memory by relevance.** Facts get embeddings too. Sorting and the Workshop add the facts most similar to the captures at hand (top 8 above a threshold) after the core profile. Keyword matching stays as the fallback when embeddings aren't ready.
    - Tests: Deno (relevant facts chosen, fallback).
- Phase done when: the Phase 7 manual checklist passes (Shortcut from the share sheet and Back Tap, bookmarklet on desktop Chrome, a flesh-out and a two-turn session with versions, next steps to tasks, and an Ask answer with working citations).

## Phase 8: Reflection

Goal: once a week Airhead looks back. A review gives themes, wins, what slipped, a few suggestions and the AI spend. A Tidy-up clears clutter safely. Patterns show habits. Leave suggestions come from bridge days. Scout proposes things to do from your own data and a few capped web searches. Every suggestion is a card you accept or dismiss. Planned in detail on 2026-11-07 from `DESIGN.md` (Insights; Memory; Scout and Check-up; Work and leave; Tidy-up and link reading).

- [x] **8.1 Weekly digest.** SQL `weekly_digest(user, week_start)` (security definer, service role), titles only:
    - completion rate, carry-overs, captures and completions by hour and weekday;
    - task types and topics that slip;
    - ideas that keep coming back;
    - notifications sent, and the week's AI spend by task.
    - Tests: pgTAP with seeded weeks.
- [x] **8.2 Tidy-up candidates.** SQL `tidy_candidates(user)`, all found in code:
    - completed tasks and read reading items over 90 days old;
    - past events with no notes;
    - exact duplicates (same type and normalised title);
    - near-duplicates (chunk embeddings, similarity ≥ 0.95);
    - Unsorted captures over 30 days old.
    - Each is marked `auto` (the low-risk cases in DESIGN) or `ask`. Meeting notes and ideas are always `ask`.
    - Tests: pgTAP.
- [x] **8.3 Weekly review function.** Migration `reviews` (one per user and week, server-written, synced read-only). Function `weekly-review` makes one large-tier call with prompt `review.v1`.
    - In: the digest, the last 4 weekly digests, the tidy candidates (titles and ages only), and near-duplicate or stale facts.
    - Out: themes, wins, what slipped, two or three organisation suggestions, Keep / Archive / Condense / Delete with a one-line reason per `ask` candidate, fact merges and retirements, and a short digest of the week.
    - `auto` candidates are soft-deleted or archived at once; all removals can be recovered for 30 days.
    - If the AI fails, a code-built review (stats only) is stored instead.
    - The scheduler runs it on the chosen day and time (default Sunday 19:00), with a "Weekly review ready" notification. A "Run now" button is on Insights.
    - Tests: Deno with fixtures (valid; schema failure falls back; an injection title does nothing; only `ask` candidates can be proposed).
- [x] **8.4 Weekly review page.** Insights → This week: themes, wins, slipped, suggestions and the AI spend line.
    - The Tidy-up card approves or skips each proposal. **Condense** creates one note with a dated timeline of the originals, linked back, and archives the originals, which stay searchable.
    - A memory card applies fact merges and retirements.
    - Tests: component tests.
- [x] **8.5 Memory digests.** Each review's digest of the week is kept. The morning brief and the next reviews read the last 4 digests instead of raw history.
    - Tests: Deno (brief input includes the digests; the budget is kept).
- [x] **8.6 Patterns.** Insights → Patterns, built from the digests and SQL stats with no AI:
    - completion by weekday;
    - capture and completion hours;
    - the carry-over trend;
    - task types that slip;
    - idea return counts;
    - notifications sent.
    - Charts follow the dataviz guidance (one hue per series, a table view, dark mode).
    - Tests: component tests.
- [x] **8.7 Bridge-day finder.** Shared code (device and server, like `today/slots.ts`): from public holidays, the work pattern and leave balances, find 1–2 leave days that give 4–5 days off. Rank by days off per leave day, and drop clashes with events and the linked calendar.
    - Tests: unit tests (Irish holidays, weekends, an existing clash, no balance left).
- [x] **8.8 Holiday suggestions.** A "Suggest leave" button on Work. It also runs monthly, and inside the weekly review when a good bridge is within 8 weeks.
    - One small-tier call with prompt `leave.v1` gets the candidates, upcoming occasions, time since the last break and busy spells, and writes two or three suggestions.
    - Each suggestion books through the existing leave flow, and only on a tap.
    - Tests: Deno with fixtures, component tests.
- [ ] **8.9 Scout data.** Migration:
    - `scout_runs` (run log: when, trigger, queries used, searches, cost);
    - `suggestions` (cards: kind, title, body, source URL, a proposed item, status open, accepted or dismissed).
    - Both sync, with own-rows RLS; the server writes runs.
    - Settings → Scout: on or off, city, interests come from memory, at most 3 searches per run.
    - Tests: pgTAP, Zod and Dexie.
- [ ] **8.10 Scout findings from own data.** Code only:
    - meetings with no summary or actions after a day;
    - prep for events and birthdays in the next 10 days;
    - overdue routines (recurring tasks past due);
    - ideas with no activity for 30 days (suggest a first step);
    - weekend slots free on both calendars.
    - Tests: unit tests.
- [ ] **8.11 Scout function.** **Verify** before building: the web search tool (`web_search_20260209`, currently $10 per 1,000 searches) and its `max_uses` and `user_location` options, in the current docs.
    - Function `scout` runs weekly with the review and from "Scout now" on Today and Insights.
    - One large-tier call gets the code findings and up to 3 web searches. Queries are built in code from interests in memory and the city only; a filter rejects names, health and personal details, and every query goes in the run log.
    - Out: at most 5 suggestion cards.
    - Web results are untrusted content and never create anything themselves. Searches are counted in AI usage (the price table gains a per-search price).
    - One weekly notification: "Airhead has N ideas for you".
    - Tests: Deno (the query builder keeps names and health out; never more than 5 cards or 3 searches; an injection in a search result does nothing; the run log is written).
- [ ] **8.12 Suggestion cards.** On Today and Insights. **Accept** creates the proposed task or event (only then), and **Dismiss** removes the card. Both feed memory: accepting adds an interest fact, and dismissing adds a "not interested in …" fact (a personal fact needs approval as usual).
    - Tests: component tests.
- Phase done when: the Phase 8 manual checklist passes (a weekly review arrives with a Tidy-up card, a Condense works, patterns show, Suggest leave gives bridge days, and Scout gives at most 5 cards with its queries listed).

## Phases 5–9 (outline)

These phases get their own detailed task plan before they are built (by the user's instruction, they are planned and built in order after Phase 4; see DECISIONS). Phases 5 to 8 are planned above.

| Phase | Scope | Key pieces |
| --- | --- | --- |
| 5. Today and morning brief | Daily AI brief and Top 3 | SQL digest; `morning-brief` (large tier); Top 3 with suggested free-time slots from calendar gaps; prep nudges written into `nudges`; code-built fallback list; round-up notification |
| 6. Notes | Typed notes and notebook stage 1 | Typed note editor; fixed-width ink page with perfect-freehand, pen-only drawing, finger scroll; text boxes; autosave and whole-document sync with conflict copies; Summarise via vision; action items confirmed into tasks |
| 7. Thinking tools | Shortcuts, bookmarklet, Workshop, Ask Airhead | `ingest-capture` with capture tokens; iOS Shortcut and Chrome bookmarklet setup guides; Workshop auto flesh-out and collaborative sessions with versions; embeddings (Supabase built-in model — verify) with pgvector and hybrid search for cited answers; memory facts chosen by relevance |
| 8. Reflection | Weekly review and insights | Weekly review (large tier) with themes, wins, slips, suggestions and AI spend; patterns; Tidy-up with auto-approved low-risk cases and soft deletes; holiday suggestions from bridge-day finder; weekly memory digests; Scout weekly and from a "Scout now" button: own-data findings prepared in code plus a capped number of web searches (Anthropic web search tool — verify price), queries from interests and city only with a run log, at most 5 suggestion cards, accept/dismiss feeding memory |
| 9. Notebook polish | Lasso and shapes | Lasso select, copy, paste and move; hold-to-snap shape recognition for circle, rectangle, line and arrow |

Anything not listed here or in the design doc goes to the later list unless it fixes a real problem found in use.
