# Airhead — test matrix

8 November 2026. Every feature the app offers, mapped to the automated tests that prove it.
Sources: `docs/DESIGN.md`, `docs/PLAN.md` (phases 1–10) and `docs/MANUAL-CHECKLIST.md`.
A test is listed only where its name or assertions show it checks that behaviour.

## Why this exists

Two bugs reached manual testing although CI was green:

1. Every AI sorting call was refused by the Anthropic API. The sorting schema had 26 union-typed parameters; the limit is 16. Unit tests only replayed saved AI answers, so no test ever built a real request.
2. On the phone, "Sort now" did nothing and sync stopped pulling. No test ran device → Edge Function → database → other device, and none ran sync over a stalled connection.

## What each layer can and cannot prove

| Layer | Runs | Can prove | Cannot prove |
| --- | --- | --- | --- |
| Unit / component (Vitest, jsdom) | `src/**/*.test.ts(x)`, `tests/node` | Pure logic, React screens, Dexie writes, the sync engine against `fakeRemote` | Real Supabase calls (every `supabase*.ts` adapter is replaced by a fake), real browsers, layout, service worker |
| Function (Deno) | `supabase/functions/**/*.test.ts` | Function logic with fake stores and saved AI answers; schema size limits; each handler (`handler.ts`: auth, CORS, body parsing, status codes) with a fake caller | The wiring in `index.ts` (real Supabase Auth, the real database, the real AI API, `pg_net` callers) |
| Database (pgTAP) | `supabase/tests/database/*.test.sql` | Migrations, RLS, triggers, SQL functions, cron schedules | That a cron job's HTTP call reaches a function; anything outside Postgres |
| End-to-end, static (Playwright) | `tests/e2e/*.spec.ts` | Real Chromium: PWA shell, offline load, calendar drag, ink, notes | Anything needing a backend (it runs in local mode) |
| End-to-end, sync (Playwright + local Supabase) | `tests/e2e-sync/*.spec.ts` | Two browsers, real Auth, PostgREST and Realtime | **Any Edge Function**: CI starts Supabase with `-x ...edge-runtime...`, so no function runs. Also no iOS Safari, no push, no Storage uploads |

Not provable by any layer here: real iPhone/iPad installs, Face ID, Pencil versus finger, real push delivery, iOS Shortcuts, Apple Calendar subscriptions, the real Anthropic API.

**New in the working tree (8 November, after the two bugs):**

- `supabase/functions/_shared/schemas/limits.test.ts`: counts union parameters in every AI output schema against the limit of 16. Runs in the existing Deno CI step.
- `supabase/functions/_shared/ai.contract.test.ts`: the real SDK, each function's real prompt and schema (sorting and, since 9 November, every other AI call and Scout's web search) against `tests/mock-ai/server.mjs`, which refuses what the real API would refuse and answers from `tests/fixtures/ai`. Runs in the existing Deno CI step.
- `tests/e2e-sync/network.spec.ts`: a stalled push does not stop sync (needs no function, so it works today); "Sort now still answers when sync is stuck" (needs `sort-batch`).
- `tests/e2e-sync/ai.spec.ts`: Sort now through the real `sort-batch` function with `mock-ai`, then a second device and Undo.
- **Not wired yet:** `ci.yml` still excludes `edge-runtime`, does not serve functions and does not start `mock-ai` with `ANTHROPIC_BASE_URL`. Until it does, `ai.spec.ts` and the second `network.spec.ts` test cannot pass in CI. Rows below mark these as "(new, not wired)".

## Key

- Unit paths are under `src/`. Function paths are under `supabase/functions/` (`fn/`). Database tests are `db/00NN` (`supabase/tests/database/00NN_*.test.sql`).
- E2E: `e2e/` = `tests/e2e`, `sync/` = `tests/e2e-sync`.
- **Gap** is blank when the behaviour is proven at the layers that matter. Otherwise it starts with **Partial** (logic proven, a link in the chain is not) or **None** (nothing automated asserts it).

## Phase 1 — Foundations

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Opens at its address and shows the shell on Capture | `App.test.tsx` | — | `e2e/smoke.spec.ts` "app loads on the Capture screen" | |
| Installable: manifest and iOS home-screen tags | — | — | `e2e/pwa.spec.ts` "web app manifest is installable", "has the iOS home-screen tags" | **Partial**: real install is device-only, needs manual |
| Full-screen standalone, safe areas (notch, home bar) | — | — | — | **None**: device-only, needs manual (a screenshot test at iPhone size could catch regressions) |
| Offline: installed app opens and shows the shell | — | — | `e2e/pwa.spec.ts` "shell still loads offline after the service worker installs" | **Partial**: Chromium only, not iOS Safari |
| Deep link (`/today`) opened offline | `tests/node/hosting.test.ts` (SPA mode) | — | `e2e/pwa.spec.ts` (goes to `/today` offline) | |
| Layout per screen size: tabs, sidebar, three panes | `app/AppLayout.test.tsx`, `app/layout.test.ts` | — | — | **Partial**: jsdom widths only; no real-browser viewport test |
| Light and dark mode | — | — | — | **None**: visual; needs manual or screenshot tests |
| Email and password sign-in; "Create account" path | `features/auth/auth.test.tsx`, `lib/auth/supabaseAuth.test.ts` | — | `sync/helpers.ts` signs up for every sync test | |
| Wrong password and invite-only messages | `lib/auth/errors.test.ts`, `lib/auth/supabaseAuth.test.ts` | `db/0029` (allow-list hook, `invite_only` marker) | — | **Partial**: no e2e of a refused sign-up against real Auth |
| Google sign-in | `features/auth/auth.test.tsx` (button only when enabled) | — | — | **None** for the flow: device-only, needs manual |
| Sign out and back in; one local database per user | `features/auth/auth.test.tsx`, `lib/db/db.test.ts` | — | — | **Partial**: no e2e sign-out → sign-in → data back |
| Each device in Settings → Devices | `features/auth/auth.test.tsx`, `lib/device.test.ts` | `db/0001` | `sync/devices.spec.ts` "each browser registers its device locally, and sync shows it on the other" | |
| App lock: Face ID / Touch ID unlocks | `features/applock/applock.test.tsx`, `lib/applock/lock.test.ts` | — | `e2e/applock.spec.ts` (virtual authenticator) | **Partial**: real biometrics device-only |
| App lock: time-out and "Immediately" | `lib/applock/lock.test.ts`, `features/applock/applock.test.tsx` | — | — | |
| App lock recovery: Sign out on the lock screen, sign in, opens unlocked | — | — | — | **None** |
| RLS on settings, devices, tokens; server timestamps | — | `db/0001` | — | |
| Health function, keep-alive, weekly backup | — | `fn/health/handler.test.ts` | — | **Partial**: workflows themselves only checked by hand |
| Cloudflare hosting: SPA fallback, no caching of SW/manifest, headers | `tests/node/hosting.test.ts` | — | — | **Partial**: preview builds checked by hand |

## Phase 2 — Capture core and sync

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Capture box focused; Enter saves (desktop), Save button (touch) | `features/capture/capture.test.tsx` | — | `sync/capture.spec.ts` (types and saves) | |
| iOS keyboard dictation | — | — | — | **None**: device-only, needs manual |
| Paste link (clipboard read only on tap) → reading item | `features/capture/capture.test.tsx`, `lib/db/captures.test.ts` | — | — | **Partial**: iOS paste prompt device-only |
| Photo attach, compressed (1600 px, WebP/JPEG), queued | `features/capture/capture.test.tsx`, `lib/files/image.test.ts`, `lib/files/upload.test.ts` | `db/0002` (bucket, own-folder policy) | — | **Partial**: upload to real Storage never runs |
| "Dentist Tue 3pm" offline → event at once, 8 s Undo toast | `features/capture/instant.test.tsx`, `lib/db/events.test.ts` | — | — | **Partial**: no browser test asserts the event and toast |
| Undo sends the capture back to "Sorting soon" | `lib/db/events.test.ts`, `features/capture/instant.test.tsx` | — | — | |
| "Sometime next week" → suggestion card; Add to calendar / Dismiss | `features/capture/instant.test.tsx`, `lib/db/events.test.ts` | — | — | |
| "3/4" is 3 April; 30+ phrases; recurrence RRULEs | `lib/rules/rules.test.ts`, `lib/calendar/sources.test.ts` | — | — | |
| Offline capture reaches the other device after reconnecting | `lib/sync/engine.test.ts` "two devices" (fake server) | — | `sync/capture.spec.ts` "a capture made offline on one browser appears on the other after reconnecting" | **Partial**: Chromium `setOffline` only; no iOS suspend/resume |
| Sync icon: "n waiting" offline, "Synced" after | `features/sync/sync.test.tsx`, `lib/sync/engine.test.ts` | — | `sync/capture.spec.ts` (asserts both labels) | |
| Settings → Sync: last successful sync, Sync now | `features/sync/sync.test.tsx` | — | — | **Partial**: no e2e |
| Push in batches of 100, pull pages of 500, cursor, late commits | `lib/sync/engine.test.ts` | `db/0002` (sync index) | — | **Partial**: only against `fakeRemote`; `supabaseRemote.ts` is never unit-tested |
| Local unpushed edits are never overwritten; deletions pulled | `lib/sync/engine.test.ts` | — | — | **Partial**: fake server only |
| Every synced table pulls | `lib/sync/engine.test.ts` "pulls every synced table" | — | `sync/tables.spec.ts` "a row in every synced table goes from device A through PostgREST to device B" (all of `SYNC_TABLES`: device tables pushed from A's outbox, server-only tables written by SQL, each compared field by field on B) | |
| Sync triggers: open, online, after a write, 60 s, Realtime | `lib/sync/engine.test.ts` | Realtime publications in `db/0015`, `0018`, `0021`, `0027` | `sync/devices.spec.ts` (Realtime nudge) | |
| A stalled request does not freeze sync | `lib/timedFetch.test.ts`, `lib/sync/engine.test.ts` (one run at a time) | — | `sync/network.spec.ts` "a stalled request does not stop sync…" (new) | **Partial**: only a stalled captures push; no stalled pull, no flaky Realtime |
| Delete → Trash → Restore within 30 days | `features/library/library.test.tsx`, `lib/db/db.test.ts`, `lib/db/sorting.test.ts` | `db/0002` (purge after 30 days) | — | |
| Search by title, body and capture text | `lib/search/search.test.ts`, `features/library/search.test.tsx` | — | — | |
| "/" jumps to Library search (not while typing) | `features/library/search.test.tsx` | — | — | |
| Export zip: Markdown per item plus JSON | `lib/export/export.test.ts`, `features/settings/export.test.tsx` | — | — | **Partial**: real download on iPad/desktop needs manual |
| Inbox → Unsorted: "Sort as Task" moves it to the Library, records a correction | `features/library/library.test.tsx`, `lib/db/sorting.test.ts` | `db/0002` (corrections) | — | |
| Library: type tabs, topic and date filters; edit, re-type, delete | `features/library/library.test.tsx`, `lib/db/sorting.test.ts` | — | — | |
| Persistent storage requested | `lib/db/db.test.ts` | — | — | **Partial**: iOS behaviour device-only |
| RLS on core tables and Storage paths | — | `db/0002` | — | |

## Phase 3 — AI sorting, link reading, lists, memory

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| AI gateway: cost, one retry, usage rows, cap, refusal, caching | — | `fn/_shared/ai.test.ts`, `db/0003` | — | |
| Every AI request is one the real API accepts (schema limits) | — | `fn/_shared/schemas/limits.test.ts`, `fn/_shared/ai.contract.test.ts` (every AI call: sorting, ask, workshop flesh-out and turn, morning brief, weekly review, import, summarise typed and ink, suggest-leave, check-contradictions, Scout's web search; saved answers checked against the schema each request sends) | — | **Partial**: mock-ai is our model of the API, not the API (gap 3, live canary) |
| Sort batch: brain dump splits into list entries, event, task | — | `fn/sort-batch/plan.test.ts`, `db/0004` | `sync/ai.spec.ts` "Sort now sorts a capture with AI…" (new, not wired) | **Partial**: `sort-batch/run.ts` (loading captures, calling `apply_sort_batch`) has no test |
| "Sort now" sorts at once and shows the result | `features/inbox/sortnow.test.tsx` (fake sorting service) | — | `sync/ai.spec.ts` (new, not wired) | **Partial**: never runs against the real function in CI. This is the phone bug |
| Sort now still answers when sync is stuck | `features/inbox/sortnow.test.tsx` "a sync that never finishes does not stop sorting" | — | `sync/network.spec.ts` "Sort now still answers when sync is stuck" (new, not wired) | **Partial**: as above |
| Sorting on app open | `features/inbox/sortnow.test.tsx` | — | — | **Partial**: fake service only |
| Five captures sorted within the threshold, no tap (cron dispatcher) | — | `db/0005` (schedule, thresholds, no call without Vault secrets) | `sync/background.spec.ts` "a capture is sorted in the background with no tap, and the item reaches the other device" (dispatcher SQL → `pg_net` → `sort-batch` with the Vault service key → device B) | **Partial**: the test runs the dispatcher's SQL itself; that pg_cron fires it every 5 minutes is `db/0005` only |
| Ambiguous capture → one-tap "Task or Idea?" | `features/inbox/review.test.tsx` | `fn/sort-batch/plan.test.ts` | — | |
| A re-sort records a correction that feeds the next batch | `features/inbox/review.test.tsx`, `lib/db/sorting.test.ts` | — | — | **Partial**: no test that the next prompt contains the last 5 corrections |
| Link: summary and key points | `features/library/reading.test.tsx` | `fn/read-link/extract.test.ts`, `fn/read-link/safeFetch.test.ts`, `fn/sort-batch/plan.test.ts`, `db/0006` | — | **Partial**: DB trigger → `read-link` → next batch never runs end to end |
| Paywalled link marked "couldn't read" | `features/library/reading.test.tsx` | `fn/read-link/extract.test.ts` | — | **Partial**: as above |
| Safe fetch: no private addresses, 3 redirects, 2 MB cap | — | `fn/read-link/safeFetch.test.ts` | — | |
| Lists: create, rename, reorder, tick, clear completed; default Shopping | `features/library/lists.test.tsx`, `lib/db/lists.test.ts` | — | — | |
| Unknown list → "Create list?" moves the entries | `features/library/lists.test.tsx`, `lib/db/lists.test.ts` | `fn/sort-batch/plan.test.ts` | — | |
| Everyday fact active; a person fact waits for approval | `features/settings/memory.test.tsx` | `db/0008`, `fn/sort-batch/plan.test.ts` | — | **Partial**: no run through the function |
| Facts only from typed captures, never web pages | — | `fn/sort-batch/plan.test.ts` | — | |
| Core profile (~400 words) in the cached prefix | — | `fn/_shared/memory.test.ts` | — | |
| "What Airhead knows about me": list, edit, delete, add, approve, restore | `features/settings/memory.test.tsx`, `lib/db/memory.test.ts` | — | — | |
| Facts unused 180 days archived nightly | — | `db/0008` | — | |
| Learned rule after four uncorrected sorts; the fifth sorts offline | `lib/db/memory.test.ts` | `db/0008` (`learn_rules`) | — | **Partial**: the full loop (server learns → rule syncs → device applies) never runs |
| A correction against a rule switches it off | `lib/db/memory.test.ts` | — | — | |
| Run check-up: findings and one-tap fixes | `lib/memory/checkup.test.ts`, `features/settings/checkup.test.tsx` | — | — | |
| Check for contradictions; "Keep the first" | `features/settings/checkup.test.tsx` (fake) | `fn/check-contradictions/check.test.ts`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs from the app; schema in `limits.test.ts` |
| Monthly check-up report on Insights | `features/settings/checkup.test.tsx` | — | — | |
| AI usage: month to date, projection, daily chart, editable prices | `lib/ai/usage.test.ts`, `features/insights/aiusage.test.tsx` | `db/0003` | — | **Partial**: matching the Claude Console is manual |
| A monthly cap pauses background sorting; captures still save | — | `fn/_shared/ai.test.ts` "cap reached: nothing is sent" | `sync/background.spec.ts` "at the monthly AI limit the batch is skipped, the capture stays Unsorted and the app says why" (limit set in Insights, background batch logs `cap_reached`, Sort now shows the limit message) | |
| Success measures: captures a day, correction rate, cost a month | `lib/ai/measures.test.ts`, `features/insights/measures.test.tsx` | — | — | |

## Phase 4 — Calendar, sharing, work and leave, import, notifications

### Calendar

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Day, week, month, agenda views; agenda is the phone default | `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` "easier viewing" (desktop and 390 × 844) | |
| Drag an event; drag a task to time-block it | `lib/calendar/sources.test.ts` (drop maths) | — | `e2e/calendar.spec.ts` "create an event from an empty slot, then drag it…", "drag a task onto the week…" | **Partial**: touch drag on iPad needs manual |
| Tap an empty slot to create an event | — | — | `e2e/calendar.spec.ts` | |
| Irish public holidays this year and next | `lib/holidays/ie.test.ts` | `fn/calendar-feed/feed.test.ts` (shared copy matches) | — | |
| Source toggles: Personal, Us, tasks, holidays, leave, linked | `lib/calendar/sources.test.ts` "hidden sources are left out", `features/calendar/calendar.test.tsx` (remembered after a reload) | — | `e2e/calendar.spec.ts` "calendars panel and search" | |
| Recurring events keep local time across the clock change | `lib/calendar/sources.test.ts` | `fn/calendar-feed/feed.test.ts` | — | |
| Select days → "Book as leave" | — | — | `e2e/calendar.spec.ts` "select days in the month view and book them as leave" | |
| Event editor: reminder override, "No reminder", default | `features/calendar/editor.test.tsx` | `db/0013` | — | |
| Calendar tables, constraints, RLS, job claims | `lib/schemas/records.test.ts` | `db/0009` | — | |

### Work and leave

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Work location chip: one tap, desktop control, calendar badge | `features/work/location.test.tsx`, `lib/work/location.test.ts`, `lib/calendar/sources.test.ts` | — | — | |
| Leave over a public holiday: 5 days cost 4 | `lib/leave/engine.test.ts` | `fn/_shared/leave/engine.test.ts` | — | |
| December–November leave year; split bookings | `lib/leave/engine.test.ts` | — | — | |
| "AL 14–18 July" proposes a booking | `lib/leave/parse.test.ts`, `lib/db/leave.test.ts`, `features/leave/leave.test.tsx` | — | — | |
| Settings → Work: entitlement, year, usual week; counter updates | `features/settings/work.test.tsx`, `lib/work/settings.test.ts` | — | — | |
| Carry-over and the run-out warning | `lib/leave/engine.test.ts`, `features/leave/leave.test.tsx` | `fn/scheduler-tick/tick.test.ts` (90/42/14 days) | — | **Partial**: the push is never delivered in a test |
| Insights → Where I worked, by week and month | `features/work/location.test.tsx`, `lib/work/location.test.ts` | — | — | |
| Past bookings marked Taken nightly | — | `db/0010` | — | |
| Leave silences the location checklist | — | `fn/scheduler-tick/tick.test.ts` ("not when tomorrow is leave") | — | |

### Sharing

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Us feed: Us events and shared leave as "Off" | `lib/db/feeds.test.ts` | `fn/calendar-feed/feed.test.ts`, `db/0009` | — | **Partial**: never served by the real function; Apple/Google Calendar needs manual |
| "Me" feed with everything | — | `fn/calendar-feed/feed.test.ts` | — | **Partial**: as above |
| "New link" stops the old link | `lib/db/feeds.test.ts` | `fn/calendar-feed/feed.test.ts` (revoked → 404) | — | **Partial**: as above |
| Linked calendar events appear within ~30 minutes | `features/settings/linked.test.tsx` (fake server) | `fn/fetch-linked-calendars/parse.test.ts`, `sync.test.ts`, `db/0011` | — | **Partial**: cron → `pg_net` → function never runs |
| Bad linked-calendar link shows a clear error | `features/settings/linked.test.tsx` | `fn/fetch-linked-calendars/sync.test.ts` | — | **Partial**: app → function call never runs |

### Import

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Fixtures PDF with "attending all home games" → reviewed series | `lib/import/pdf.test.ts`, `lib/import/import.test.ts` | — | — | **Partial**: no screen test of the PDF route |
| .ics file and CSV (column mapping) | `lib/import/import.test.ts`, `features/calendar/import.test.tsx` (CSV) | — | — | |
| Delete a series removes its events | `features/calendar/series.test.tsx` | — | — | |
| Screenshot read by one AI call; "time TBC" | `features/calendar/import.test.tsx` (fake), `lib/import/import.test.ts` | `fn/import-extract/run.test.ts`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs from the app |
| An .ics link offers "Add it as a linked calendar instead" | — | `fn/import-extract/run.test.ts` (iCalendar returned as text) | — | **Partial**: the offer on screen is not asserted |
| Clashes flagged; working-day events offer leave | `lib/import/import.test.ts`, `features/calendar/import.test.tsx` | — | — | |
| Original file kept with the series | `lib/import/import.test.ts` | `db/0012` | — | **Partial**: Storage upload never runs |

### Notifications

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Enable notifications (permission on tap) and send a test | `features/settings/notifications.test.tsx`, `lib/push/push.test.ts` | `fn/_shared/push.test.ts` | — | **Partial**: `send-push/index.ts` has no test; real delivery device-only |
| iPhone not installed: explains Add to Home Screen | `lib/push/push.test.ts` | — | — | |
| First device gets notifications; iPhone takes over; iPad and desktop silent | `lib/push/push.test.ts` | — | — | |
| Event reminder 30 minutes before | — | `db/0013`, `fn/scheduler-tick/tick.test.ts` | — | **Partial**: cron → tick → push never runs; delivery manual |
| Location checklist the evening before | — | `fn/scheduler-tick/tick.test.ts` | — | **Partial**: as above |
| Evening review notification; screen ticks, carries over, drops | `features/review/review.test.tsx` | `fn/scheduler-tick/tick.test.ts` | — | **Partial**: as above |
| Quiet hours (event reminders may pass) | — | `fn/scheduler-tick/tick.test.ts` | — | |
| "Time confirmed yet?" a week before a TBC event | — | `db/0013` | — | |
| Over the daily cap → one summary | — | `fn/scheduler-tick/tick.test.ts` | — | |
| Slip nudge for tasks carried 3+ times; stale nudges cancelled | — | `fn/scheduler-tick/tick.test.ts` | — | |
| Settings → Notifications: per device, types, quiet hours, default | `features/settings/notifications.test.tsx`, `lib/notifications/settings.test.ts` | — | — | |
| Tapping a notification opens the right screen | `sw/payload.test.ts` | — | — | **Partial**: the service worker's click handler never runs in a browser test |
| Scheduler runs every minute; jobs run once | — | `db/0014`, `db/0009` (claims) | — | |

## Phase 5 — Today and morning brief

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Morning round-up at the chosen time, opens Today | — | `fn/scheduler-tick/tick.test.ts`, `fn/morning-brief/brief.test.ts` | — | **Partial**: delivery device-only |
| Today: brief, events, Top 3 with slots, Also today | `features/today/today.test.tsx` | `fn/morning-brief/brief.test.ts`, `db/0015`, `db/0016`, `_shared/ai.contract.test.ts` | — | **Partial**: a server brief never reaches a device in a test |
| "Block" puts the task on the calendar | `features/today/today.test.tsx` | — | — | |
| Carry-over cards: Today / Done / Drop | `features/today/top3.test.tsx` | — | — | |
| Add to Top 3 from the Library; a fourth asks which to swap | `features/today/top3.test.tsx` | — | — | |
| Offline before the brief: code-built list | `features/today/today.test.tsx`, `lib/today/fallback.test.ts` | — | — | |
| Free slots (device and server copies match) | `lib/today/slots.test.ts` | `fn/_shared/today/slots.test.ts` | — | |
| Settings → Today: Regenerate with cost; brief time | `features/settings/today.test.tsx` | `fn/morning-brief/brief.test.ts` (Regenerate sends no round-up) | — | **Partial**: Regenerate never calls the real function |
| Desktop right panel: Top 3 and next events | `features/today/today.test.tsx` | — | — | |
| Low AI cap: the morning list still arrives (fallback) | — | `fn/morning-brief/brief.test.ts` | — | |

## Phase 6 — Notes

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Typed note: headings, lists, checkboxes; saves; survives reload | `features/notes/notes.test.tsx` | `db/0018` | `e2e/notes.spec.ts` "a typed note keeps its text and formatting after a reload" | **Partial**: checkboxes not asserted |
| "Start notes" on an event makes a linked meeting note | `features/notes/meeting.test.tsx` | — | — | |
| Pen colours and widths, highlighter, eraser, undo, redo | `lib/ink/strokes.test.ts`, `lib/ink/render.test.ts` | — | `e2e/ink.spec.ts` "a drawn stroke is saved, can be erased and undone…" | **Partial**: Pencil draws / finger scrolls is device-only |
| Page grows; text boxes added, moved, deleted | `lib/ink/strokes.test.ts`, `lib/ink/texts.test.ts` | — | `e2e/ink.spec.ts` "text boxes: add with the text tool…" | |
| Edited on two devices, one offline → "conflicted copy" | `lib/sync/notes-sync.test.ts` | `db/0018`, `db/0019` | — | **Partial**: no two-browser test |
| Summarise typed and handwritten notes | `features/notes/summarise.test.tsx` (fake) | `fn/summarise-note/run.test.ts`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs from the app |
| Ticked action items become tasks; unticked do not | `features/notes/actions.test.tsx`, `lib/db/actions.test.ts` | — | — | |
| Search finds words from a summarised handwritten page | `features/notes/library.test.tsx` | — | — | |
| Summarised handwritten note view-only on phone/desktop, editable on iPad | `features/notes/library.test.tsx` | — | — | |

## Phase 7 — Thinking tools

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Capture token: create (shown once), last use, revoke | `features/settings/tokens.test.tsx` | `db/0020` | `sync/tokens.spec.ts` "a capture token made in Settings saves a capture through ingest-capture; once revoked it gets 401" | |
| Share sheet / Shortcut saves link, text, photo | `features/settings/shortcuts.test.tsx` (guide) | `fn/ingest-capture/run.test.ts` | `sync/tokens.spec.ts` (text through the real `ingest-capture`) | **Partial**: the Shortcut itself is device-only; photo uploads not run end to end (gap 18) |
| "Quick thought" on Back Tap / Action Button | — | — | — | **None**: device-only, needs manual |
| Bookmarklet and `/share` save the page with selected text | `features/capture/share.test.tsx` | — | — | **Partial**: manifest `share_target` not asserted |
| Workshop: Auto flesh-out draft with versions | `features/workshop/workshop.test.tsx`, `lib/db/workshop.test.ts` | `fn/workshop/run.test.ts`, `db/0021`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs from the app |
| Work on it together; offline answer sent later | `features/workshop/session.test.tsx` | `fn/workshop/turn.test.ts`, `_shared/ai.contract.test.ts` | — | **Partial**: as above |
| Next steps become tasks in one tap | `features/workshop/nextsteps.test.tsx` | — | — | |
| Ask Airhead answers with citations that open the source | `features/library/ask.test.tsx` (fake) | `fn/ask/run.test.ts`, `db/0023`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs; no real embeddings |
| Embeddings queued, chunked, searchable | — | `fn/embed-items/run.test.ts`, `db/0022`, `db/0024` | — | **Partial**: the `gte-small` model never runs in a test |
| Memory by relevance (top facts after the core profile) | — | `fn/_shared/relevant.test.ts`, `fn/workshop/run.test.ts`, `db/0024` | — | |

## Phase 8 — Reflection

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Weekly review on the chosen day: themes, wins, slipped, suggestions, spend | `features/insights/review.test.tsx` | `fn/weekly-review/run.test.ts`, `fn/scheduler-tick/tick.test.ts`, `db/0025`, `db/0027`, `_shared/ai.contract.test.ts` | — | **Partial**: never generated by the real function in a test; push manual |
| Tidy-up: low-risk items archived (restorable); Condense makes one note | `features/insights/review.test.tsx` | `db/0026`, `fn/weekly-review/run.test.ts` | — | |
| Patterns: completion by weekday, capture hours, table view | `features/insights/patterns.test.tsx` | `db/0025` | — | |
| Suggest leave: bridges avoiding events and the linked calendar | `lib/leave/bridges.test.ts`, `features/leave/ideas.test.tsx` | `fn/_shared/leave/bridges.test.ts` | — | |
| "Ask Airhead to pick" and booking via the normal leave flow | `features/leave/ideas.test.tsx` (fake) | `fn/suggest-leave/run.test.ts`, `_shared/ai.contract.test.ts` | — | **Partial**: function never runs from the app |
| Bridge hint inside the weekly review | — | — | — | **None**: not seen asserted |
| Scout now: at most 5 cards; run log lists the queries | `features/settings/scout.test.tsx`, `features/today/scout.test.tsx` (fake) | `fn/scout/run.test.ts`, `fn/scout/findings.test.ts`, `db/0028`, `_shared/ai.contract.test.ts` (web search request through the real SDK) | — | **Partial**: function never runs from the app |
| Accept creates the item; Dismiss adds a "not interested" fact | `features/today/scout.test.tsx` | — | — | |
| Brief and reviews read the last 4 digests | — | `fn/morning-brief/brief.test.ts` | — | |

## Phase 9 — Notebook polish

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Lasso selects strokes and text boxes (dashed box) | `lib/ink/selection.test.ts` | — | `e2e/ink.spec.ts` "lasso: a loop around strokes selects them…" | |
| Move, delete, undo, redo | `lib/ink/selection.test.ts` | — | `e2e/ink.spec.ts` "lasso: drag a selection to move it, delete it, undo both" | |
| Copy and paste into another note | `lib/ink/clipboard.test.ts` | — | `e2e/ink.spec.ts` "copy a selection in one note and paste it into another" | |
| Hold to snap: line, arrow, rectangle, circle; undo; scribbles stay | `lib/ink/shapes.test.ts` | — | `e2e/ink.spec.ts` "hold the pen still… to snap it" (line only) | **Partial**: Pencil hold on iPad needs manual |

## Phase 10 — AI actions

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| "9.5 days left": chip, counter shows 9.5, Undo restores | `lib/db/aiActions.test.ts`, `features/inbox/aiActions.test.tsx` | `fn/sort-batch/actions.test.ts`, `db/0031` | — | **Partial**: never through the real function |
| "off 22-24 Dec" books 3 days | — | `fn/sort-batch/actions.test.ts`, `db/0031` | `sync/ai.spec.ts` "a leave note becomes an action…" (new, not wired) | **Partial**: as above |
| "I get 23 days a year" sets the entitlement | — | `fn/sort-batch/actions.test.ts` | — | **Partial**: as above |
| "WFH Mondays" sets the usual week | — | `fn/sort-batch/actions.test.ts` (usual week, merged) | — | **Partial**: as above |
| "dentist moved to Thursday 4pm" moves it and its reminder | — | `fn/sort-batch/actions.test.ts`, `db/0031` | `sync/ai.spec.ts` (new, not wired) | **Partial**: as above |
| Two matches → "Which one?"; picking one moves it | `lib/db/aiActions.test.ts`, `features/inbox/aiActions.test.tsx` | `fn/sort-batch/actions.test.ts` | — | |
| "remind me the day before" | — | `fn/sort-batch/actions.test.ts`, `db/0031` | — | |
| No entitlement → "Needs your OK" with "Set your yearly entitlement first" | `features/inbox/aiActions.test.tsx` | `fn/sort-batch/actions.test.ts` | `sync/ai.spec.ts` (new, not wired) | |
| Edited by hand since: Undo leaves it alone | `lib/db/aiActions.test.ts`, `features/inbox/aiActions.test.tsx` | `db/0031` (freshness checks) | — | |
| A web page saying "set my leave to 30 days" changes nothing | — | `fn/sort-batch/plan.test.ts` (page text ignored) | — | |
| Existing events and tasks sent as candidates (≤ 60) | — | `fn/sort-batch/candidates.test.ts` | — | |
| `ai_actions` synced; RLS | `lib/schemas/records.test.ts` | `db/0030` | — | |

## Phase 11 — Calendar and Workshop

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Longer dated note: instant event at once, capture still sorted by AI, event tidied (title, end, repeat) and the lost task added; Undo | `lib/db/captures.test.ts`, `lib/db/aiActions.test.ts`, `lib/db/events.test.ts` | `fn/sort-batch/plan.test.ts`, `_shared/ai.contract.test.ts`, `db/0034` (applied, stale → proposal, ai_actions row) | `sync/ai.spec.ts` "a longer dated note…" | |
| Notes join AI sorting: a typed note's new text (≤ 1,500 characters, ≤ 5 notes) becomes tasks, events and actions; the note text is unchanged; stamped `ai_seen_at` whatever the answer | `lib/db/notes.test.ts`, `features/inbox/sortnow.test.tsx` (Sort now for a waiting note) | `fn/sort-batch/notes.test.ts`, `_shared/ai.contract.test.ts` (note block), `db/0035` (applied, stamped, deleted note skipped) | `sync/ai.spec.ts` "a typed note is read by AI…" | |
| Cost guard: a changed note alone is due only after 30 minutes; it rides along with any batch | — | `db/0035` (`users_due_now`, `notes_waiting_for_ai`) | — | **Partial**: the dispatch → function chain runs end to end for captures (`sync/background.spec.ts`), not yet for a note on its own |
| Memory digest stored as an everyday fact (source `digest`), duplicates skipped | — | `fn/sort-batch/notes.test.ts`, `_shared/ai.contract.test.ts`, `db/0035` | — | **Partial**: no e2e check of the fact row |
| A reminder on a tidied instant event lands on that event (target index 0) | — | `fn/sort-batch/notes.test.ts`, `db/0035` (tidy carries data) | — | |
| Time ranges ("8pm-12pm", "8-11pm", "20:00-23:00") set the end time | `lib/rules/rules.test.ts`, `lib/db/captures.test.ts` | — | `sync/ai.spec.ts` "Quiz every Thursday 8pm-12pm keeps its end time" | |
| Send to Workshop on every capture (Capture recent list, Inbox Unsorted), item and note; a capture without an item becomes a note (text word for word, linked by capture_id); idempotent; chip "Sent to Workshop" | `features/workshop/routing.test.tsx` | — | `sync/ai.spec.ts` "Send to Workshop on a fresh capture…" (seen on the second device) | |
| AI routing: unplaced captures (or skipped ones) and `leftover` words become Workshop notes; `suggest_workshop` on placeholders; a note's leftover marks the note | `features/workshop/routing.test.tsx` (chips) | `fn/sort-batch/workshop.test.ts`, `_shared/ai.contract.test.ts` (placeholder + vague), `_shared/schemas/limits.test.ts` (10 union params), `db/0036` | `sync/ai.spec.ts` "Sort now on a placeholder note…", "a note sorting cannot place…" | A typed note's leftover has no e2e check |
| Event details sheet: when, repeat in words, calendar and colour, reminder, prep reminders, location, notes, Open notes; Edit, Delete (asks first), Send to Workshop; linked events read-only | `features/calendar/calendar.test.tsx`, `lib/calendar/view.test.ts` (when, repeat words) | — | `e2e/calendar.spec.ts` "tapping an event shows its details first…" (desktop), phone agenda test | |
| Views remembered per device; period titles; Today, previous, next; red now line; opens at the current time; swipe | `lib/calendar/view.test.ts`, `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` "week opens at now with a red line…", phone "…swipe between periods" | Real finger swipe on iPhone (manual) |
| Phone month: dots per day and the selected day's list | `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` phone test | |
| Agenda: 30 days, grouped by day, sticky headers, times / all-day / repeat / colour, loads more, empty state | `lib/calendar/view.test.ts`, `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` phone test | Scroll-to-load needs a real browser: covered by the Show more button in tests |
| Event search, past and future, opens the details | `lib/calendar/view.test.ts`, `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` "calendars panel and search" | |
| Quick add: live preview (title, when, end, repeat in words, calendar) from the Capture rules; Enter / Add saves, Undo; More options opens the form filled in; no date → the next hour | `lib/calendar/quickAdd.test.ts`, `features/calendar/quickadd.test.tsx` | — | `e2e/calendar.spec.ts` "faster adding" (desktop 1440 and phone 390 × 844) | Saved through the same `save()` as the editor, so it syncs like any event (`sync/calendar.spec.ts`) |
| Tap an empty slot in Day / Week (phone and desktop) for an hour-long event; drag for a span; Add event on the phone month's chosen day | — | — | `e2e/calendar.spec.ts` "faster adding" phone test, "create an event from an empty slot…" | Real finger on iPhone (manual) |
| Event form: repeat (none, daily, weekly on chosen days, monthly, yearly, every N), end repeat (never, on a date, after N times), rule in words; rules the form cannot show are kept | `lib/calendar/repeat.test.ts`, `features/calendar/editor.test.tsx` | — | `e2e/calendar.spec.ts` "faster adding" desktop test | |
| Repeating events: edit, drag or delete one occurrence asks This event / This and following / All events; "this" = exception (`data.exdates`) + one-off (`data.parent_id`, `data.recurrence_id`); "following" = UNTIL the day before + a new series (COUNT continued, weekly days moved, later exceptions and changed ones carried); "all" moves the series by the same days and time of day | `lib/calendar/occurrence.test.ts`, `lib/db/recurring.test.ts` (rows and outbox), `features/calendar/calendar.test.tsx` (chooser in details and the form; changed repeat hides "This event") | — | `e2e/calendar.spec.ts` "repeating events" (desktop drag + this and following + delete one; phone edit all + delete this and following), `sync/calendar.spec.ts` "one occurrence deleted and one changed on device A show the same on device B" | |
| Deleted or changed occurrences get no reminder from the series and are EXDATEs in the subscribed feed | — | `fn/scheduler-tick/tick.test.ts`, `fn/calendar-feed/feed.test.ts` | — | The morning brief skips them too: `db/0038_morning_digest_exdates.test.sql`, `fn/morning-brief/brief.test.ts` |
| Repeat in words everywhere: details, agenda and month-day rows (subtitle and icon tooltip) | `lib/calendar/repeat.test.ts`, `features/calendar/calendar.test.tsx` | — | `e2e/calendar.spec.ts` details and phone tests | Search rows show the date, not the rule |
| Missing events: a weekly timed, a yearly all-day and a one-off all-day event made on device A show in Day, Week, Month and Agenda on A and on B after sync | `lib/calendar/view.test.ts` "missing events" | — | `sync/calendar.spec.ts` | |
| UI foundation: tokens follow the system scheme; a subtree can force light or dark | `ui/ui.test.tsx` (design kit panels) | — | `e2e/ui.spec.ts` (dark and light canvas, forced panels) | Device only: real iPhone safe areas and SF Pro rendering (manual checklist) |
| Shared components: Button loading, Sheet focus trap / Esc / backdrop / focus return, SegmentedControl keys, ListRow link vs button, fields labelled and described, Toggle switch, Toast timeout and action | `ui/ui.test.tsx` | — | `e2e/ui.spec.ts` (sheet, segmented control in a real browser) | |
| App shell: phone tab bar navigates (390 × 844), tabs at least 44 px, Calendar and Settings in the top bar; sidebar on desktop in the same order; current page marked | `app/AppLayout.test.tsx` | — | `e2e/shell.spec.ts` | Device only: iPhone Home Screen safe areas (manual checklist) |
| Inbox badge counts captures waiting, and keeps the link's name | `app/AppLayout.test.tsx` | — | — | |
| Large title moves into the phone top bar once scrolled; dark mode reaches shell and pages | — | — | `e2e/shell.spec.ts` | |
| Design kit reachable from Settings → About, every component in light and dark | `ui/ui.test.tsx` | — | `e2e/ui.spec.ts` | |
| Pages on the shared components (11.U2): Capture, Today (Top 3, events, From yesterday, suggestions, leave to book, Scout ideas, work location), Inbox (Needs a tap, Needs your OK, Done by AI with Undo, Unsorted, To flesh out), Evening review | existing page tests (`features/capture`, `today`, `inbox`, `review`, `leave`, `work`), `ui/ui.test.tsx` (buttonClasses, small buttons 44 px on touch, Section label) | — | `e2e/pages.spec.ts` "11.U2 pages" (phone 390 × 844 and desktop: renders, main action, 44 px buttons, axe WCAG A/AA, dark mode) | Real iPhone feel (manual checklist) |
| Pages on the shared components (11.U3): Library (filters, search, item page, lists, trash, Ask), Insights, typed and handwritten notes (`.ah-note-page`, ToolButton toolbars), Workshop, Work and leave (leave form in a Sheet, switches) | existing page tests (`features/library`, `insights`, `notes`, `workshop`, `leave`) | — | `e2e/pages-u3.spec.ts` (phone 390 × 844 and desktop: renders, main action, 44 px buttons, axe WCAG A/AA, dark mode) | Pencil feel on a real iPad (manual checklist) |
| Pages on the shared components (11.U4): Settings panels (switches, chips, inline fields), sign-in, lock and loading screens, Share page | `features/settings/*.test.tsx`, `applock/applock.test.tsx`, `auth/auth.test.tsx`, `capture/share.test.tsx` | — | `e2e/pages-u4.spec.ts` (phone and desktop: axe WCAG A/AA, 44 px buttons, a setting saved and kept, dark mode); `sync/signin-ui.spec.ts` (sign-in screen and signed-in Settings with the real server, phone light and dark and desktop, axe) | Lock screen with real Face ID (manual checklist) |

## Phase 12 — Trust: every note counts

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| A note that implies more work gets a planning task with checklist steps, due before the first occurrence (or in 3 days), and up to 3 specific questions with quick answers; generic questions dropped; clear notes get none | — | `fn/sort-batch/followups.test.ts`, `_shared/ai.contract.test.ts` (placeholder → event, planning task, 3 questions), `_shared/schemas/limits.test.ts` (10 union params), `db/0039` (inserted with the batch, owner-only RLS, none for a capture sorted meanwhile) | `sync/ai.spec.ts` "Sort now on a placeholder note: the event, a planning task with steps, and questions" (server rows checked) | Whether the real model asks well: `ai-eval` on dev |
| `follow_ups` syncs between devices | `lib/db/db.test.ts`, `lib/schemas/records.test.ts` | `db/0039` | `sync/tables.spec.ts` (every synced table) | |
| Questions for you in the Inbox (question, the note it came from, quick answers, text box, Dismiss), on the item page, and a Today card | `features/inbox/followups.test.tsx` | — | `sync/ai.spec.ts` "a question asked on A is answered on B…" | |
| An answer is a capture linked to its question; the next batch adds it to the item (Undo) and acts on it; one more round at most; Dismiss is a correction | `features/inbox/followups.test.tsx` (linked capture, correction, Undo of the details) | `fn/sort-batch/followups.test.ts` (answers), `_shared/ai.contract.test.ts` (answer block), `db/0039` (body update) | `sync/ai.spec.ts` "a question asked on A is answered on B; the new task and details reach A; Dismiss is a correction" | |
| "What Airhead did" on every capture (Capture → Recent, Inbox, item page "From your note"): one line per outcome with its words; Undo from the receipt; "Kept as written, not acted on"; waiting with the next check time | `lib/db/receipts.test.ts`, `features/capture/receipt.test.tsx` | — | `sync/ai.spec.ts` "What Airhead did: waiting before sorting, then every outcome with its words, on both devices" | |
| Completeness: notes that imply more work get a planning task, specific questions and nothing dropped; clear notes get no questions; no question beside a clear action | `fn/sort-batch/followups.test.ts` (action guard) | `fn/ai-eval/run.test.ts` (mock: Christmas, car insurance, team night pass), `ai-eval` real model on dev after each prompt change (`ai_eval_runs`) | — | Real-model results vary run to run: watch `ai_eval_runs` |
| Insights → Notes handled: handled of total, waiting, questions by status, correction rate, "Not acted on: N" opens the list | `features/insights/noteshandled.test.tsx` | — | — | Computed from synced rows already proven end to end (`sync/tables.spec.ts`, `sync/ai.spec.ts`) |

## Phase 13 — The planner

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Default timings: prepare the evening before (before noon) or 3 h before, never inside 45 min; leave = start − travel − 10; do at a task's due time; nothing in the past | — | `fn/_shared/plan/defaults.test.ts` (owner's training case, noon, Dublin clock change, all-day, tasks) | — | Pure logic; delivered through 13.3 |
| Defaults applied on save: a changed event or task is queued; each tick writes `plan:<kind>:<item>:<date>` nudges for the next 8 days, never over an AI or owner nudge, cancels those for occurrences that no longer exist; `leave` and `do` come through quiet hours | — | `fn/scheduler-tick/plan.test.ts`, `fn/scheduler-tick/tick.test.ts` (quiet hours, stale leave), `db/0042` (trigger, queue, `upsert_plan_nudge` precedence and past times) | `sync/plan.spec.ts` "an event at 08:00 gets a prepare the evening before and a leave at 07:20, on both devices" | |
| The morning brief sends no prep nudge for anything starting within 2 hours, or already prepared by a `plan:prepare` nudge; the text still mentions it | — | `fn/morning-brief/brief.test.ts` (training at 08:30, planner-prepared, the 2-hour line) | — | Server-side only; nudges reach devices as in 13.3 |
| Planner digest: tomorrow in full, later items that need lead time, linked events, work location, pending nudges, plans, capped at 60 | — | `fn/plan-day/digest.test.ts` (normal, prep rule, empty, over the cap, deleted occurrence), `db/0043` | — | Input to the evening run (13.6), covered end to end there |
| Evening planner: one small-tier call; plan validated (unknown ids, past, prepare inside 45 min, quiet hours, 3 per occurrence, daily cap, reading to digest) and applied in one transaction; never touches the owner's nudges; daily planning cap; nothing to plan → no call | — | `fn/plan-day/validate.test.ts`, `fn/plan-day/run.test.ts`, `_shared/ai.contract.test.ts` (planner against mock-ai), `_shared/schemas/limits.test.ts` (`PlanResult`), `db/0044` (idempotent, owner's items only, never `source = user`, totals) | — (dispatch arrives with 13.7) | Real-model quality: `ai-eval` planner cases (13.9) |
| The planner runs once a day at the evening time (local, summer time), not when off; 90 minutes later a `defaults` run row if none succeeded; Settings → Today "Plan my day at" and the switch | `features/settings/today.test.tsx` | `fn/scheduler-tick/tick.test.ts` (dispatch time, once a day, time zones, fallback, a failing plan) | — | The `plan_runs` once-a-day index is in `db/0041` |
| "Why now?" on the item page and event details; a tapped planner notification opens the item with the snooze sheet; snooze/Done/Not needed through `nudge_outcome`; a new `user` nudge for a snooze; untouched for 12 h → ignored | `features/plan/plan.test.tsx` (panel, sheet, failures, past pick, no server) | `fn/scheduler-tick/tick.test.ts` (tap URL, ignored each tick), `db/0045` (owner only, snooze row, dismiss cancels, ignored) | `sync/plan.spec.ts` "snoozing a reminder on one device shows the new time and the outcome on the other" | Real taps on iPhone notifications: manual checklist |
| Real-model planner cases (bag the evening before, dentist, untimed task, quiet-hours leave, empty day): structure, not wording | — | `fn/ai-eval/run.test.ts` (all five through mock-ai, and the checks catch a 07:30 prepare, an untimed push and a quiet-hours push), `ai-eval` on dev with the real model | — | Real-model results vary run to run: watch `ai_eval_runs` |
| A moved, closed or deleted item cancels its pending AI plan nudges; the default takes over a cancelled AI nudge; a dismissed one stays dismissed; the owner's own stay | — | `db/0046` | `sync/plan.spec.ts` (defaults on save) | Re-plan by AI after a change: 15.3 |
| `item_plans` and `nudges` sync to the device (pull-only); `plan_runs` owner-only; new nudge kinds and columns | `lib/db/db.test.ts`, `lib/schemas/records.test.ts` | `db/0041` (RLS for a second user, one plan per item, once-a-day runs, kind and outcome checks, devices cannot write) | `sync/tables.spec.ts` (every synced table) | |

## Phase 14 — History the planner can reach

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Day summaries: nightly at 03:10 from `day_digest_source`; one small call, 120 words, item ids kept; empty day → "Nothing recorded." without a call; stale days rebuilt from sources; a failure waits for the next night | `lib/db/db.test.ts`, `lib/schemas/records.test.ts` | `fn/day-digest/run.test.ts`, `fn/scheduler-tick/tick.test.ts` (03:10 once a night), `_shared/ai.contract.test.ts` (against mock-ai), `_shared/schemas/limits.test.ts`, `db/0047` (sources, one a day, stale trigger within 30 days, RLS) | `sync/tables.spec.ts` (every synced table) | Wording quality: read a few on dev |
| Month summaries: last month from its weekly digests (one small call, 150 words, week starts kept), "Nothing recorded." without a call, stale when a weekly digest changes | `lib/db/db.test.ts`, `lib/schemas/records.test.ts` | `fn/day-digest/month.test.ts`, `fn/scheduler-tick/tick.test.ts` (03:20 once a night), `_shared/ai.contract.test.ts`, `_shared/schemas/limits.test.ts`, `db/0048` (first-of-month check, one a month, stale trigger, RLS) | `sync/tables.spec.ts` (every synced table) | |
| Pages built by code: series (series and repeating events), topic, place at 3+ events; kept in step through `page_queue`; owner may only rename or archive | `lib/db/db.test.ts`, `lib/schemas/records.test.ts` | `db/0049` (grouping, place threshold and matching, unlink on leave and delete, counts, owner edits, RLS) | `sync/tables.spec.ts` (`pages` from a device, `page_items` from the server) | Page view on the device: 14.10 |
| People and projects: sorting returns mentions (at most 5 per capture, cleaned in code), kept in `items.data.mentions`; the page drain links them by normalised name; person pages wait for approval; unlinked when no longer mentioned | `features/settings/memory.test.tsx` (People Airhead noticed) | `fn/sort-batch/followups.test.ts` (cleanMentions, per-capture limit), `_shared/schemas/limits.test.ts`, `fn/ai-eval/run.test.ts` ("people-project" through mock-ai), `db/0050` | `sync/tables.spec.ts` (`pages`) | Real model: `ai-eval` case "people-project" on dev |
| Page summaries: changed pages marked stale (link or item change); nightly at 03:30, at most 20, rebuilds first; existing summary plus changed items in; 150 words and 8 dated facts; rebuild from every item; only active pages | `lib/schemas/records.test.ts` | `fn/page-summary/run.test.ts`, `fn/scheduler-tick/tick.test.ts`, `_shared/ai.contract.test.ts`, `_shared/schemas/limits.test.ts`, `db/0051` (stale triggers, due list, owner may only ask for a rebuild) | `sync/tables.spec.ts` (`pages` with the new columns) | The Rebuild button arrives with the page view (14.10) |
| AI call with look-ups: zero, two and over-limit look-ups; a look-up that throws; results wrapped as data that cannot close its block; every round logged; cap and API error as `callAI` | — | `_shared/ai.test.ts` (scripted rounds), `_shared/ai.contract.test.ts` (a real request with tools through mock-ai's scripted round) | — | The planner uses it in 14.8 |
| Look-ups: search_history (hybrid, dates, types, limit, works without the embedding model), get_page (normalised name, summary, facts, 8 recent items), previous_occurrences (same series, else similar earlier events, with prep and nudge outcomes) | — | `fn/_shared/history/lookups.test.ts` (seeded store), `db/0052` (`hybrid_search_for`: one person only, service only) | — | Used by the planner in 14.7–14.8 |
| Library → Pages: list by kind (active only), page view (summary, facts, items with notes), Rebuild / Rename / Archive written and queued for sync, links from an item to its pages | `features/library/pages.test.tsx` | `db/0049`, `db/0051` (what the owner may change) | `sync/tables.spec.ts` (`pages` from a device) | Look on a real phone: manual checklist |
| The planner uses history: recent summaries in the message, the three look-ups as tools (at most 4), the count in `plan_runs.lookups_used`; real-model cases for a detail from last time and a fact from a person's page | — | `fn/plan-day/run.test.ts` (history ahead of the digest, tools offered, count recorded), `fn/ai-eval/run.test.ts` (cases wired; history cases need the real model), `_shared/ai.contract.test.ts` | — | Real model: `ai-eval` cases "plan-repeat-detail" and "plan-dinner-page" on dev |
| Ask reads pages: summaries of active pages linked to the found items (at most 3, non-empty) go before the passages, never cited; a question about something three months old links its source | — | `fn/ask/run.test.ts` (pages in the message), `fn/ai-eval/run.test.ts` (ask case wired) | — | Real model: `ai-eval` case "ask-three-months" on dev |

## Phase 15 — Morning digest and re-plan

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Morning refresh: 20 min before the brief, once a day, not when the planner is off; only items and linked events changed since the evening run finished; nothing changed → skipped, no call | — | `fn/plan-day/run.test.ts`, `fn/scheduler-tick/tick.test.ts`, `db/0053` (`updated_at` on each row) | — | Same validate and apply path as the evening run (`db/0044`) |
| Digest delivery: `delivery = digest` never pushed alone; listed in the next round-up (morning brief or evening review) and marked sent; per-kind setting (as planned, push, digest, off) | `features/settings/notifications.test.tsx` | `fn/scheduler-tick/tick.test.ts` (round-up, per-kind override, off cancels) | — | Round-up on a real phone: manual checklist |
| Re-plan on change: queue records why (changed, snoozed, missed); defaults at once; after 5 quiet minutes a replan of only those items, 10 a run, 6 runs a day, not when off | — | `fn/scheduler-tick/plan.test.ts` (debounce, limits, off), `fn/plan-day/run.test.ts` (replan only the given items), `db/0054` (reasons, defaults again after a change) | `sync/plan.spec.ts` "moving tomorrow 08:00 to 15:00 replaces the evening prepare with a same-day one" | |
| The brief from the plan: plan in the message and in `content.plan` (prepare now, clashes, ready today, reading pick); "Left out" whenever the digest was capped or nudges dropped; kept in the fallback; Today shows it | `features/today/today.test.tsx`, `lib/schemas/records.test.ts` | `fn/morning-brief/brief.test.ts`, `_shared/ai.contract.test.ts` (brief through mock-ai) | `sync/tables.spec.ts` (`briefs`) | |
| Reading slots: the evening digest carries active topics (3+ links) and up to 8 unread links; a saved link takes only a `reading` nudge, always digest, with its slot stored in `item_plans.reading_slot` | — | `fn/plan-day/validate.test.ts`, `fn/plan-day/run.test.ts`, `db/0056` | — | Real model: `ai-eval` reading cases (16.8) |
| Reading item on the device: kind, minutes, source, summary, key points, why saved, topics; Library row line; unreadable reason and "Open anyway" | `features/library/reading.test.tsx` | — | `sync/tables.spec.ts` (items carry `data`) | |
| Enrich a link: one small call per readable page with the page as data and the owner's words as the note; minutes from code; lists trimmed; unreadable → reason in plain words, no call; every reading item of a capture read with its own link | — | `fn/read-link/enrich.test.ts`, `_shared/ai.contract.test.ts` (against mock-ai), `_shared/schemas/limits.test.ts` (`LinkEnrichment`), `fn/read-link/extract.test.ts` | — | e2e-sync cannot fetch a public page: `safeFetch` refuses the local stack's private addresses by design, so "captured on one device, enriched on the other" is manual (checklist) |
| Topic matching: exact, then normalised names, then the closest by meaning above the threshold, else new; without embeddings, new | — | `fn/_shared/topics.test.ts` (fixture vectors) | — | The threshold was set on fixture vectors, not real gte-small output: see BLOCKERS |
| App badge (overdue tasks + open questions, installed app only) and Declarative Web Push fields beside Airhead's own (with APP_URL; never `app_badge`) | `lib/badge.test.ts` | `_shared/push.test.ts` | — | Badge and Safari delivery on a real iPhone: manual checklist |
| Weekly review on planner data: planner runs, outcomes, slipped tasks with plans, next week's commitments and free minutes in the message; move/split/drop proposals checked (known tasks, a date, 2–5 steps, at most 5) and stored as proposed AI actions; applied only on approval, undoable | `lib/db/aiActions.test.ts` (drop and split applied, undone) | `fn/weekly-review/run.test.ts`, `db/0059` (new kinds) | `sync/ai.spec.ts` (proposals reach Needs your OK) | Real model: proposal quality on dev (review runs weekly) |

## Phase 17 — Learning and the weekly review

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Outcome statistics: per kind and per series/place/person page, 8 weeks, counts and median snooze shift; nightly at 03:40; owner reads | — | `db/0057` (counts, median, window, per page, RLS), `fn/scheduler-tick/tick.test.ts` | — | Server-side only (read by 17.2–17.4) |
## Phase 16 — Reading that collates itself

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Every link: mid-sentence, several, trailing punctuation, duplicates and tracking parameters, non-http ignored; one reading item per distinct link; the rest of a longer note waits for sorting; a repeat joins the first item; sorting never adds a second reading item for a link | `lib/rules/links.test.ts`, `lib/db/captures.test.ts` | `fn/sort-batch` suite | `sync/tables.spec.ts` (items) | |
| Topic pages: collated from 3 reading items (prompt `topic.v1`): summary ≤ 200 words, per-link note in `page_items.note`, overlaps, open questions, next step; updates from the existing summary; removing a link rebuilds; owner cannot write the collation | — | `fn/page-summary/run.test.ts` (threshold, notes for known links), `_shared/ai.contract.test.ts` (third to fifth link through mock-ai), `_shared/schemas/limits.test.ts`, `db/0055` (reading count, rebuild on removal) | `sync/tables.spec.ts` (`pages.collation`) | |
| Insights → Planner costs: cost per day by run kind, look-ups, defaults days | `features/insights/aiusage.test.tsx`, `lib/ai/planCosts.test.ts` | `db/0041` (`plan_runs_daily`, owner only) | — | |

## Cross-cutting

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| Every Edge Function handler (`index.ts`): auth header, CORS, body parsing, status codes | — | `fn/*/handler.test.ts` (ask, check-contradictions, fetch-linked-calendars, import-extract, ingest-capture, read-link, send-push, sort-batch, suggest-leave, summarise-note, workshop, health), `fn/_shared/userOrService.test.ts` (morning-brief, weekly-review, scout), `fn/_shared/serviceOnly.test.ts` (embed-items, scheduler-tick, ai-eval), `fn/calendar-feed/feed.test.ts`, `fn/_shared/serviceAuth.test.ts` | — | **Partial**: each `index.ts` is now only wiring (`Deno.serve(handler)` with Supabase-backed deps), checked by `deno check` and, for the functions the app calls, by `sync/*.spec.ts` |
| App-side function adapters (`src/lib/*/supabase*.ts`, 13 files) | — | — | — | **None**: every screen test swaps them for fakes |
| Treat pages, imports, calendars and captures as data | — | `fn/sort-batch/plan.test.ts`, `fn/workshop/run.test.ts`, `fn/summarise-note/run.test.ts`, `fn/import-extract/run.test.ts`, `fn/check-contradictions/check.test.ts`, `fn/morning-brief/brief.test.ts` | — | |
| Desktop shortcuts Ctrl/Cmd+K, N, E, T, ?; bulk task actions (DESIGN.md) | — | — | — | **None**: not built (only "/" exists); not in PLAN |


### Sync recovery and diagnostics (2026-11-09)

| Feature | Unit/component | Function/DB | End-to-end | Gap |
| --- | --- | --- | --- | --- |
| A run stuck past its limit is dropped by any trigger; the device sends its sync log | `sync/engine.test.ts` (stale run, diary sent) | `db/0040_sync_logs.test.sql` | — | **Partial**: why the iPhone's watchdog never fired is not yet reproduced; the sync log on the device is how it will be found |

## Gaps to close before user testing

Ordered by risk. Sync and AI first.

1. **Run Edge Functions in the e2e-sync job.** Remove `edge-runtime` from the `-x` list, serve the functions with `ANTHROPIC_BASE_URL` pointing at `tests/mock-ai/server.mjs`, and start the mock before Playwright. This makes the new `sync/ai.spec.ts` and `sync/network.spec.ts` count. Layer: CI / e2e-sync.
2. **Done (9 November).** `ai.contract.test.ts` now sends every function's real prompt and schema through the real SDK to `mock-ai`, including Scout's web search; `mock-ai` answers each task from `tests/fixtures/ai` (new: `leave.json`, `scout.json`, `workshop.json` turn) and refuses a saved answer that does not fit the request's schema. The functions' own parsers and clean-up read the answers. Was: **Contract test for every AI call, not just sorting.** Extend `ai.contract.test.ts` so each function's real prompt and schema (ask, workshop flesh-out and turn, morning-brief, weekly-review, import-extract, summarise-note, suggest-leave, check-contradictions) is sent through the real SDK to `mock-ai`. Add scout's web-search request. Teach `mock-ai` to answer each task from the saved fixtures. Layer: Function (Deno).
3. **Optional live canary against the real API.** One cheap small-tier sorting call on `workflow_dispatch` (or after each dev deploy), with its own tiny cap. The mock only knows the limits we taught it. Layer: CI, manual trigger.
4. **Sort now on a stalled or slow connection, end to end.** After item 1, keep "Sort now still answers when sync is stuck" and add: function times out → the screen says so; pulls resume afterwards and the sorted items reach device B. Layer: e2e-sync.
5. **Stalled pull and lost Realtime.** Hang a GET (pull) once and drop the Realtime socket; assert device B still gets the change through the 60 s poll and the indicator recovers. Layer: e2e-sync.
6. **Done (9 November).** CI puts the local stack's URL (`http://kong:8000`) and demo service key in Vault and stops pg_cron's schedules; `sync/background.spec.ts` backdates a capture past the 2-minute wait, runs `dispatch_sort_batches()` and sees it sorted and the item on device B with no tap. Was: **Background sorting by cron.** In the e2e-sync stack, put the service key in Vault, run `dispatch` (or wait for it) with a threshold of 1, and assert the capture is sorted with no tap. Layer: e2e-sync (DB + function).
7. **Link reading chain.** Capture a link to a local fixture page (serve `tests/fixtures/html/article.html` and `paywalled.html`); assert the summary and "couldn't read" appear on device B after the next batch. Needs a safe-fetch test allowance for the fixture host. Layer: e2e-sync.
8. **Done (9 November).** Each function's request handling moved from `index.ts` to `handler.ts` (`handleX(req, deps)`), and every handler has tests: OPTIONS → CORS headers, wrong method → 405, missing or unknown token → 401, service-only functions refuse a user token, a user's call runs for that user whatever `user_id` the body names (another user's idea, capture, device or calendar is not found), bad JSON → 400 where the body matters. Was: **Handler tests for each function `index.ts`.** Missing user token → 401; another user's id → refused; bad JSON → 400; OPTIONS → CORS headers. Covers sort-batch, read-link, ask, workshop, morning-brief, weekly-review, scout, import-extract, summarise-note, suggest-leave, send-push, ingest-capture, fetch-linked-calendars, embed-items, check-contradictions, scheduler-tick. Layer: Function (Deno).
9. **`sort-batch/run.ts` with a real database.** Insert captures, run the function against the local stack with mock-ai, and assert items, `ai_actions`, `ai_usage` rows and capture statuses. This is the step that the unit tests skip. Layer: Function + DB (e2e-sync job).
10. **AI actions through the whole chain.** After item 1, cover "I get 23 days", "WFH Mondays", "remind me the day before" and "which one?" in `sync/ai.spec.ts`, and check the second device. Layer: e2e-sync.
11. **Unit tests for the app-side adapters.** `supabaseRemote.ts` (pull query shape, cursor overlap, upsert conflict target) and the 13 `supabase*.ts` function adapters (function name, body, error mapping, time-out via `timedFetch`). Layer: Unit.
12. **Done (9 November).** `sync/tables.spec.ts` builds one row per table from the sync engine's own `SYNC_TABLES` (a new table without a row fails the type check and the test), checks each against the app's schema, writes the device tables into A's local database with outbox entries, then checks each reached the server and that B holds every row as sent (server-written tables come from SQL). Was: **Sync of every table through real PostgREST.** One e2e-sync test that writes a row to each synced table on A and reads it on B (catches a missing column, RLS or schema mismatch). Layer: e2e-sync.
13. **Note conflict copy across two browsers.** Edit a note on A offline and on B online; reconnect A; assert the "conflicted copy". Layer: e2e-sync.
14. **Push pipeline up to the push service.** Run `scheduler-tick` and `send-push` against the local stack with a fake push endpoint; assert a due nudge is posted with the right payload and a 410 clears the subscription. Real delivery stays manual. Layer: Function + DB.
15. **Service worker notification click.** In Playwright, post a push payload to the service worker and assert `notificationclick` opens the path. Layer: e2e static.
16. **Done (9 November).** `sync/tokens.spec.ts`: Settings → Create token, POST to the real `ingest-capture`, the capture on the device and "Last used" set, Revoke, then the same token gets 401 and nothing is saved. Was: **Capture token end to end.** Create a token in the app, POST to `ingest-capture`, see the capture on the device, revoke, get 401. Layer: e2e-sync.
17. **Outgoing feed and linked calendars against real functions.** Fetch `calendar-feed?t=` from the local stack and parse it; add a linked calendar served from a fixture URL and see its events. Layer: e2e-sync.
18. **Photo and import file uploads to Storage.** Attach a photo on A; assert the object in `captures/<user id>/` and the image on B. Layer: e2e-sync.
19. **Done (9 November).** `sync/background.spec.ts`: €1 spent, a €0.50 limit set in Insights → AI usage, the background batch logs `cap_reached`, the capture stays Unsorted, no items, and Sort now says "This month’s AI limit has been reached". Was: **Monthly cap end to end.** Set a tiny cap; assert the batch is skipped, captures stay Unsorted and the app explains it. Layer: e2e-sync.
20. **Smaller UI gaps.** App lock recovery via Sign out; calendar day and agenda views and the phone default; source toggles; checkboxes in typed notes; the ".ics link → add as linked calendar" offer; the weekly review's bridge hint; manifest `share_target`. Layer: Unit or e2e static.
21. **Manual only, keep on the checklist.** Real installs and safe areas, light/dark look, Face ID, Google sign-in in the installed iPhone app, dictation, Pencil versus finger and hold-to-snap, iOS Shortcuts and Back Tap, real push delivery and quiet hours on the iPhone, Apple Calendar subscription, AI usage against the Claude Console.
