# Changelog

One line per merged PR, newest first.

- Task 7.9: embeddings (gte-small, 384 dimensions) for every item's text, kept up to date by the scheduler
- Task 7.8: a draft's next steps become tasks in one tap (linked to the idea)
- Task 7.7: Work on it together (two or three questions per turn, draft updated as a new version; answers typed offline are sent later)
- Task 7.6: Workshop page and Auto flesh-out (structured draft, saved as a new version; older versions one tap away)
- Task 7.5: Workshop data (draft versions numbered by the server, sessions, Send to the Workshop)
- Task 7.4: "Send to Airhead" bookmarklet and PWA share target (both land on /share; no token in web pages)
- Task 7.3: iOS Shortcuts guide (Send to Airhead from the share sheet, Quick thought on Back Tap or the Action Button), in the docs and in Settings
- Task 7.2: ingest-capture function for Shortcuts (text, links and photos saved Unsorted; token checked and rate limited)
- Task 7.1: capture tokens for iOS Shortcuts (create once, last use, revoke; hashed; 60 an hour)
- plan: phase 7 (Thinking tools, tasks 7.1–7.11)

## Phase 6 — Notes (ready for device testing, not yet released)

Typed notes (headings, lists, checklists) and handwritten pages: the Pencil draws, a finger scrolls, there are pens, a highlighter, an eraser, undo and redo, and text boxes, and the page grows as you write. Notes save while you type and sync as whole documents. If two devices edit the same note offline, a "conflicted copy" keeps both versions. Meetings get a date, attendees and Start notes from a calendar event. Done → Summarise makes one large-tier AI call that reads the typed text, or the pages as images, and returns a summary, decisions and action items. Ticked action items become tasks. Summaries, transcriptions and note text are searchable, and summarised pages are view-only on phone and desktop. Summarise needs BLOCKERS item 9 in dev. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 6.

- release: phase 6
- Task 6.9: notes in the Library: summary above the original, view-only pages on phone and desktop, search over typed text, text boxes, summaries and transcriptions
- Task 6.8: action items from a summary become tasks (ticked ones only, linked to the note, due dates read by the free rules)
- Task 6.7: Summarise notes (typed text or handwritten pages as images): summary, decisions and action items, stored on the note and searchable
- Task 6.6: text boxes on handwritten pages (add, move, delete)
- Task 6.5: handwritten page (perfect-freehand, Pencil draws and fingers scroll, pens, highlighter, eraser, undo and redo, grows as you write)
- Task 6.4: meeting details (date, attendees) and Start notes / Open notes on events
- Task 6.3: typed notes (TipTap editor with headings, lists and checklists; saved while typing; New note and New meeting note)
- Task 6.2: conflicted copies for notes edited on two devices (on the server and on pull); nothing is lost
- Task 6.1: note documents (typed or handwritten, one per note, server-numbered versions)
- plan: phase 6 (Notes, tasks 6.1–6.9)

## Phase 5 — Today and morning brief (ready for device testing, not yet released)

Each morning, one large-tier AI call (with a server-side refusal fallback) turns a SQL digest into a short brief, a Top 3 with free time slots found in code, Also today and prep nudges. If the AI isn't available, a code-built list goes out instead. A round-up notification arrives at the chosen time. Today shows the brief, events, Top 3 (Block a slot; add, swap or remove by hand), Also today and From yesterday cards; the desktop panel shows Today at a glance; Settings → Today sets the time and day window and can regenerate the brief. Needs BLOCKERS items 8–10 in dev. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 5.

- release: phase 5
- Task 5.9: Settings → Today (brief time, day window for slots, Regenerate with its cost)
- Task 5.6: the morning brief runs from the scheduler at the chosen time (default 07:30) with its round-up; one switch for both
- Tasks 5.7 and 5.8: Today tab (brief, events, Top 3 with Block slots, Also today, desktop glance), Top 3 by hand with swap, From yesterday cards
- Task 5.4: morning-brief function (one large-tier call with server-side refusal fallback, validated Top 3 with code-found slots, prep nudges, round-up; code-built list on any failure)
- Tasks 5.3 and 5.5: free time slots and the code-built daily list (shared by the app and the server)
- Task 5.2: morning digest in SQL (events, tasks, yesterday, leave, ideas; titles only)
- Task 5.1: morning briefs table (one per day, server-written, synced read-only)
- plan: phase 5 (Today and morning brief, tasks 5.1–5.9)

## Phase 4 — Calendar, sharing, work and leave, import, notifications (ready for device testing, not yet released)

- **Calendar**: day, week, month and agenda views (FullCalendar 7). Personal, Us, time-blocked tasks, linked calendars, Irish holidays and leave each have a colour and a show/hide toggle. Drag to reschedule, drag tasks in to time-block, tap a slot to create.
- **Work and leave**: settings, an on-device leave engine (half days, carry-over and expiry, weekend holidays), booking from the calendar or "AL 14–18 July" captures, a leave counter, and a work-location chip with Insights.
- **Sharing**: private Us and my-phone subscribe links (hashed tokens), and linked calendars refreshed every 30 minutes.
- **Import**: .ics, CSV and Excel exactly on the device; PDFs, screenshots, links and text with one AI call; a review table with clashes and leave; saved as a series you can recolour or delete.
- **Notifications**: Web Push with Home Screen guidance; reminders generated in the database; a minute-by-minute scheduler (quiet hours, daily cap with summaries, evening review, checklist, slip and leave run-out); notification settings.

Needs BLOCKERS items 8–10 (Vault secrets, Anthropic key, VAPID keys) in dev. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 4.

- release: phase 4
- Fix: imported schedules can be recoloured or deleted as a whole from Calendar → Import
- Task 4.15: notification settings (per-type switches, quiet hours, daily cap, reminder default, job times, per-device on/off)
- Task 4.14: evening review screen (tick off, carry over with carry count, drop, carry all)
- Task 4.13: scheduler tick every minute (recurring reminders, evening review, location checklist, slip and leave run-out nudges once a day, quiet hours, daily cap with summaries)
- Task 4.12: reminders generated in the database from items (event reminders with per-event choice, task due reminders, time-TBC checks; moved, cancelled or re-armed as items change)
- Task 4.11: push notifications setup (VAPID via secrets, Settings → Notifications with Home Screen guidance, one receiving device, test notification, `send-push` clearing expired subscriptions, service worker show and open)
- Task 4.10: import a schedule (.ics, CSV and Excel exactly on device; PDFs, screenshots, links and pasted text with one AI call; instruction filters; review with clashes and leave; saved as a series with the original file)
- Task 4.9: linked calendars (check and add a secret iCal link, server fetch every 30 minutes with recurrences expanded 12 months ahead, removals and errors tracked)
- Task 4.8: outgoing calendar feeds (Us and my-phone links with hashed tokens, `calendar-feed` iCalendar with stable UIDs, recurrences, shared leave as Off and work locations)
- Task 4.7: work location chip on Today and the desktop panel (one-tap change, one row per day across devices), Insights days per location by week and month
- Task 4.6: leave UI (book from the calendar or the Work screen, half days, statuses, share to Us; "AL 14–18 July" proposals on Today; leave counter on Today and Work; nightly Taken job)
- Task 4.2: Calendar (FullCalendar 7): day, week, month and agenda; Personal, Us, tasks, linked calendars, holidays and leave with toggles; location badges; create, drag, resize and time-block tasks
- Task 4.5: leave engine (leave years, working-day counting with half days, balances, carry-over and expiry, weekend-holiday days, closures, pace, run-out)
- Task 4.4: Settings → Work (working days and hours, leave year, entitlement and carry-over, weekend holiday rule, closure days, one-off holidays, leave types, weekly locations, checklists, Us sharing)
- Task 4.3: Irish public holidays on device (Easter computus, St Brigid's Day rule, common days off, manual one-offs)
- Task 4.1: calendar tables (series, feeds, linked events, work days, leave bookings, nudges, job runs) with RLS, sync and Dexie v4

## Phase 3 — AI sorting, link reading, lists, memory (ready for device testing, not yet released)

Captures are sorted by AI in batches through a logged, capped gateway (Haiku/Sonnet, prompt caching, structured output): brain dumps split into items, topics and lists, unsure items get one-tap choices, links are read safely and summarised, Lists with a default Shopping list, AI usage and success measures on Insights, memory facts with approval and learned rules applied offline, and a memory check-up with one-tap fixes. Needs the Anthropic key and Vault secrets (BLOCKERS 8 and 9). Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 3.

- release: phase 3
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
