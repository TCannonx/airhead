# Changelog

One line per merged PR, newest first.

- Task 3.10: memory check-up (code checks with one-tap fixes and savings, contradictions check, monthly run on Insights)
- Task 3.9: memory facts (approval for people/personal, ~400-word cached profile, 180-day archive) and learned rules applied instantly on the device
- Task 3.8: success measures on Insights (captures/day, correction rate, AI cost per month)
- Task 3.7: Insights → AI usage (month to date, projection, daily chart, by task, monthly limit, editable prices)
- Task 3.6: Lists (default Shopping, create/rename/reorder, tick off, clear completed) and "Create list?" from sorting
- Task 3.5: link reading (safe fetch, readable text, couldn't-read fallback) and summaries in the next sort batch
- Task 3.4: Inbox "Needs a tap" one-tap choices for unsure AI sorting; re-sorts recorded as corrections
- Task 3.3: sorting triggers (app open, Sort now, 5-minute scheduler with thresholds)
- Task 3.2: sort-batch function (brain-dump splitting, topics, lists, review routing) applied atomically
- Task 3.1: AI gateway (usage log, editable prices, monthly cap, structured output with one retry, prompt caching)

## Phase 2 — Capture core and sync (ready for device testing, not yet released)

Usable offline from here: Capture tab (box, paste link, compressed photos), free on-device rules (links → reading list, British dates, instant events with Undo, suggestions, recurrence), local database per user with an outbox, two-way sync with Supabase (Realtime nudges, late-commit overlap, offline queue, photo upload), Inbox with one-tap sorting and corrections, Library with filters, item editing, Trash, on-device search, export everything, and a sync status indicator. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 2.

## Phase 1 — Foundations (ready for device testing, not yet released)

Installable, signed-in app shell for iPhone, iPad and desktop Chrome: offline shell, responsive layouts, Google / email-code sign-in, device list, optional Face ID / Touch ID lock, Supabase schema with RLS, CI with database and function tests, dev deploy, live release, keep-alive and backup workflows. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 1.

- Task 2.10: sync status indicator (synced / n waiting / offline) and last sync + Sync now in Settings
- Task 2.9: Settings → Export everything (zip with full JSON backup, one Markdown file per item, photos)
- Task 2.8: on-device search (MiniSearch, incremental) in the Library, "/" shortcut on desktop
- Task 2.7: Inbox (Unsorted with one-tap sorting, To flesh out), Library tabs and filters, item edit/re-sort/delete, Trash with restore
- Task 2.6: confident dates become events instantly (8 s Undo toast), fuzzy ones become suggestion cards on Today; event chips
- Task 2.5: free on-device rules (links → reading items, British date parsing, confidence rule, recurrence → RRULE) with a 36-phrase test table
- Task 2.4: Capture tab (autofocused box, Enter/Save, Paste link, compressed photo attach with upload queue, recent captures with chips); offline-capture cross-device e2e
- Task 2.3: sync engine (outbox push, overlapping keyset pull, merge, triggers, Realtime), local-first device registration, cross-device e2e against local Supabase
- Task 2.2: local Dexie database per user, outbox and sync state, shared Zod schemas, persistent storage request
- Task 2.1: captures, items, lists, topics, corrections tables with RLS, Realtime, nightly purge, private captures bucket
- Task 1.8: health function, function tests in CI, deploy-dev, release, keep-alive and weekly backup workflows
- Task 1.7: Cloudflare Pages hosting files (SPA mode, `_headers`, Node version) and setup steps
- Task 1.6: optional app lock with Face ID / Touch ID (WebAuthn), inactivity time-out, sign-out recovery
- Task 1.5: sign-in (Google login only, emailed 6-digit code fallback), device registration, Settings account and devices, local mode without a server
- Task 1.4: Supabase project files, migration 0001 (settings, devices, capture_tokens, RLS, sync trigger), pgTAP RLS tests, CI workflow
- Task 1.3: responsive layout (phone tabs, iPad sidebar, desktop three panes), routes for all six screens, light/dark, safe areas
- Task 1.2: installable PWA shell (manifest, iOS tags, placeholder icons, offline app-shell service worker)
- Task 1.1: scaffold (Vite + React + TypeScript strict, Tailwind, ESLint, Prettier, Vitest, Testing Library, Playwright)
