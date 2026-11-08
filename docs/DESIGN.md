# Airhead — Design Doc

6 November 2026

## Overview

Airhead is an offline-first PWA for iPhone, iPad and desktop Chrome that takes anything you throw at it during the day and sorts it into tasks, events, reading, ideas, meeting notes and notes. It is built for one person first (me), designed so other users can be added later without a rewrite, and built mostly with Claude Code.

Guiding principles:

- **Capture never waits.** Every capture saves to the device instantly, offline included; sorting happens afterwards.
- **Originals are sacred.** The AI never edits or silently deletes what you wrote; removals are soft and recoverable for 30 days.
- **Free first, AI where it adds value.** On-device rules handle the obvious; a small model handles sorting in batches; a larger model runs only for briefs, reviews and on-demand work.
- **Near-zero infrastructure cost.** Free tiers throughout; AI is the only real running cost, and it is measured and capped.
- **Calm, not nagging.** Notifications go to the phone only, with quiet hours and a daily cap.

## Core concepts

Everything starts as a **Capture** (the raw input, never altered) and is sorted into one or more **Items**, each linked back to its source. A brain dump stays one capture and is split into several items by the AI.

| Item type | What it holds |
| --- | --- |
| Task | Optional due date and time, recurrence, carry-over count |
| Event | Time, recurrence, calendar (Personal or Us); confident events are created automatically, others wait as suggestions |
| Reading item | Link, title, AI summary and key points, reading time, read status |
| Idea | Topic tags, Workshop drafts and versions, return count |
| Meeting note | Handwritten page or typed note, transcription, summary, decisions, action items |
| Note | Anything else, kept and searchable |

**Lists** are a seventh item type: personal named lists (shopping, packing, films to watch). Captures like "need milk, bin bags" are sorted onto the right list as checkable entries. Sharing a list with my girlfriend is on the later list, as it needs her to have a login.

Supporting records: **Nudges** (scheduled notifications attached to items), **Topics** (tags that group ideas and notes), **Corrections** (your re-sorts, reused as examples so sorting learns your habits), and **AI usage** (one row per AI call with its cost).

The app has five tabs:

1. **Capture:** one box, pen, paste; the home screen.
2. **Today:** the brief, Top 3, "Also today", events and suggestion cards.
3. **Inbox:** two sections, "Unsorted" and "To flesh out" (the Workshop).
4. **Library:** reading, ideas, meetings, notes and lists, plus search and Ask Airhead.
5. **Insights:** evening and weekly recaps, patterns, Tidy-up and AI usage.

## Architecture

A React + TypeScript PWA keeps a full copy of everything on each device and syncs with Supabase, which handles sign-in, the database, files, server functions and scheduling.

```text
Your devices                    Supabase (free plan)              External services
------------                    --------------------              -----------------
Airhead PWA  <-- sync -->       Google sign-in (login only)
(full offline copy,             Postgres + pgvector (RLS)
 ink, free date rules)          File storage (compressed images)
iOS Shortcuts / bookmarklet --> Functions + scheduler  ---------> AI models (small and larger)
(share sheet capture)           (batches, briefs, nudges) ------> Partner calendar (Us feed out, her feed in)
                                                          ------> Push notifications (iPhone only)
```

The PWA syncs both ways with Supabase; Shortcuts post captures straight to a server function, and only the functions talk to AI, partner calendar feeds and push.

**On device (free):** local IndexedDB database; on-device date parser and recurrence library; perfect-freehand for ink; installable PWA with offline caching; app files on a free static host.

**Supabase (free plan):**

- **Google sign-in,** used only as a login (Apple sign-in can be added); no calendar permissions are requested.
- **Postgres database** with per-user row-level security from day one, so adding users later is mostly a sign-up screen; pgvector for Ask Airhead.
- **File storage** for attached images, compressed on device before upload.
- **Functions and scheduler:** sorting batches, morning brief, weekly review, flesh-outs, meeting summaries, link reading, calendar feed publishing and linked-calendar import, push sending and Shortcut ingest. The scheduler runs every few minutes for due nudges and ready batches, plus daily and weekly jobs.

**Security and cost controls:**

- The AI key lives only in server secrets, never in the app.
- Each iOS Shortcut uses a personal, revocable capture token.
- All AI calls go through one internal function that picks the model and logs cost.
- **Untrusted content is data, never instructions.** Web pages, imported files and shared calendars are passed to the AI clearly marked as content; anything the AI derives from them can only be a suggestion that needs my tap, never an automatic action.
- **Separate dev and live projects:** the free plan's two projects become a test project Claude Code can break freely and a live project holding my data.
- **App lock:** optional Face ID or Touch ID via passkeys, with a chosen time-out.
- **Export everything:** one tap exports all data as Markdown plus JSON, doubling as a backup and avoiding lock-in.
- Free-plan safeguards: an external keep-alive ping against the 7-day inactivity pause, a weekly backup export, and a storage meter with a warning at 70%.

**Storage expectation:** year one of personal use is roughly 150–250 MB of the 500 MB database and near-zero file storage if screenshots are avoided. Upgrading to Pro ($25/month) needs no migration.

## Capture flows

Capture must never make you wait or think: it saves locally first, then free rules run instantly, then AI sorts later.

**In the app (Capture tab):** text box focused on open; iOS keyboard dictation; a Paste button when a link is on the clipboard; a pen button for a quick ink scribble; optional photo attach.

**From anywhere (iOS Shortcuts, v1):**

- **Send to Airhead** in the share sheet for links, text and images.
- **Quick thought** on Back Tap or the Action Button for a one-line dictated or typed capture.
- Both post to a server function with the capture token. Offline, the Shortcut says so and suggests opening the app.

**Instant, free processing after save:**

- **Links** go to the reading list; a server function fetches title, description and article text when online.
- **Dates and times** are parsed on device. Clear, future, unambiguous ones are added to Airhead's built-in calendar with an undo toast, even offline; fuzzy ones become one-tap suggestion cards.
- **Everything else** goes to Unsorted for the next batch.

Each capture shows a chip ("Reading list", "Event added: Sat 11:00", "Sorting soon"); tapping it re-sorts and records a correction.

## Import schedule

A file, image, link or pasted text plus an instruction ("attending all", "only home games") becomes a reviewed series of events in one step, at most one AI call per import.

**Accepted inputs:** PDF, screenshot or photo, CSV or Excel, .ics file, pasted text, or a link to a fixtures page.

**Processing, free routes first:**

1. .ics and CSV/Excel are parsed in code (exact, no AI); CSV gets a quick column-mapping step if headers are unclear.
2. Text PDFs and web pages have their text extracted in code, then one small-model call structures it into events.
3. Scanned PDFs, screenshots and photos go to a vision model once.
4. The instruction is applied as a filter (all, home only, weekends only, a named team).

**Review before saving:** a table of proposed events (date, time, title, venue), all ticked by default; choose Personal or Us; confirm in one tap. Nothing is auto-added from an import.

**Saved as a series** (e.g. "Dublin GAA 2027") with the original file attached: edit, recolour or delete the whole series at once.

**Defaults:** unconfirmed times become all-day "time TBC" events with a nudge to check nearer the date; each event gets a reminder and an optional day-before prep nudge ("tickets, jersey, check travel").

**Clash and leave checks:** clashes with existing events are flagged; events on working days offer to book leave.

**Staying current:** if the source publishes an .ics feed, it can be added as a linked calendar instead so rescheduled fixtures update automatically.

## AI pipeline

AI runs as a three-tier funnel: free on-device rules, a small model in rolling batches, and a larger model only for scheduled summaries or when you ask.

| Task | Model | When it runs |
| --- | --- | --- |
| Sorting, brain-dump splitting, topic tags | Small (e.g. Claude Haiku) | Rolling batch |
| Link summaries and actions | Small | Rolling batch, once per link |
| Morning brief | Larger (e.g. Claude Sonnet) | Daily, chosen time |
| Weekly review and Tidy-up | Larger | Weekly, chosen day |
| Flesh-out and collaborative Workshop | Larger | On tap |
| Meeting summary (handwriting via vision) | Larger | On tap, once per meeting |
| Ask Airhead answers | Small or larger (config) | On question |

**Rolling batch triggers** (all settings): about 5 items waiting, the oldest unsorted item about an hour old, app opened with unsorted items, or "Sort now".

**Batch input:** waiting captures, today's date and timezone, existing topics, active idea titles, and a few recent corrections. **Output:** strict JSON per capture (items, type, title, dates, topics, confidence, Workshop suggestion), validated against a schema; one retry, then the capture stays Unsorted. Low confidence lands in the Inbox as a one-tap choice.

**Token discipline:** no call sends the whole database; briefs and reviews get SQL-built digests; fixed instructions use prompt caching; meeting pages are transcribed once.

**AI usage screen:** per-call logging by task, euros via an editable price table, month-to-date with daily chart, projected month-end, cost estimates on on-demand buttons, an optional monthly cap that pauses background AI, and an "AI this week" line in the weekly review. Estimates are labelled as such; the provider's dashboard is the true record.

**Ask Airhead (v1):** items and transcriptions are chunked and embedded (Supabase's built-in embedding model, to be confirmed in planning) and stored with pgvector. A question runs hybrid keyword plus vector search, sends the top ~8 passages to the model, and returns an answer with tappable source citations. Online only; regular search works offline.

**AI actions (Phase 10):** the same sorting call can return actions as well as items: set the leave left or used, book leave, change five work settings (entitlement, leave year, working days, usual week, carry-over limit), set a reminder, or move an existing event or task (the model sees the person's upcoming open events and tasks as data). Code checks every action against the person's own data: clear ones (confident, valid, no clash, nothing missing) are applied straight away with Undo under "Done by AI"; the rest wait under "Needs your OK" with a plain reason (Apply, pick which one, Fix or Dismiss). Undo and Apply never overwrite something changed since. Saved web pages and imports never produce actions. Spec: `docs/superpowers/specs/2026-11-08-ai-actions-design.md`.

**Failure mode:** offline, outage or cap reached means captures still save, free rules still run, and items wait in Unsorted.

## Memory

Airhead keeps a small, visible memory that makes AI calls more tailored and, over time, cheaper: a fact profile, rolling weekly digests, and learned rules that skip AI entirely.

**Fact profile:** short facts with source, date learned and last used ("Jim is a close friend", "Training is Tue/Thu 7pm", "Errands captured late at night are best nudged at 9am"). Sorting batches may propose new facts at no extra call; the weekly review merges duplicates and retires stale ones.

- **Auto-added:** everyday facts (routines, preferences, places, teams, work patterns).
- **Needs approval:** facts about people and personal details (relationships, health, birthdays, anything sensitive), shown as a one-tap card.
- Facts are learned only from my own captures, never from web pages, imports or linked calendars.
- A "What Airhead knows about me" screen lists every fact to edit, delete or add; unused facts are archived after about 6 months.

**Rolling digests:** each weekly review saves a short digest of the week; the brief and later reviews read the last few digests instead of raw history.

**Learned rules:** when the AI sorts the same pattern the same way several times without a correction (e.g. "buy …" → Shopping list), Airhead creates an on-device rule so future captures of that kind are sorted instantly, offline and free. Rules are listed in Settings and can be switched off.

**Budget:** a core profile of a few hundred words goes with every call (placed in the cached prompt prefix so it is billed at the reduced cached rate); only facts relevant to the captures at hand are added beyond that, chosen by keyword match and later by Ask Airhead embeddings.

**Build:** fact profile, approval cards, the knows-about-me screen and learned rules in phase 3; relevance matching by embeddings in phase 7; weekly digests in phase 8.

## Scout and Check-up

Scout uses memory, the calendar and open items to propose things to do, including from the web; Check-up keeps memory lean. Both are visible buttons: Airhead has no hidden commands, and every action is reachable from a button.

**Scout (proactive suggestions):**

- **From my own data (prepared in code first):** missing follow-ups after meetings, prep for upcoming events and birthdays, overdue routines, stalled ideas with a suggested first step, and free time shared with my girlfriend's linked calendar.
- **From the web:** a few searches built from interests in memory and my city (fixtures released, tickets going on sale, events on weekends we are both free), using Anthropic's web search tool — verify its per-search price in planning.
- **When:** weekly alongside the weekly review, and from a "Scout now" button on Today and Insights.
- **Limits:** at most 5 suggestions and a small fixed number of searches per run, all counted in AI usage.
- **Suggestions only:** every finding is a card to accept or dismiss; web results are untrusted content and never create anything directly.
- **Privacy:** queries use interests and city only, never names, health or other personal details; every query is listed in a run log.
- **Learning:** accepts and dismissals become memory facts ("not interested in midweek concerts").
- **Notification:** one weekly "Airhead has 4 ideas for you".

**Check-up (memory health):** a "Run check-up" button in Settings → Memory and in Insights. Code checks for free: core profile size against its budget and words added per call, near-duplicate and stale facts (unused 90+ days), pending approvals, rarely used or often corrected rules, rising average request size per AI task, plus storage, sync and AI cost trends. An optional "Check for contradictions" button runs one small AI call to find conflicting facts and propose merges. Each finding has a one-tap fix and shows its saving ("archiving 12 facts trims about 150 words from every call"). A code-only check-up also runs monthly and posts its result to Insights.

## Notes

Meeting notes come in two styles, both summarised and searched the same way, built only on open-source (MIT) parts with no licence cost.

**Handwritten page:** a fixed-width page that scrolls down and grows as you write, rendered with perfect-freehand. Toolbar: pen (a few colours, two widths), highlighter, eraser, lasso, text boxes for quick labels, undo and redo. Apple Pencil draws and fingers scroll (palm rejection by pointer type). Strokes are stored as compact stroke data, not images.

**Typed note:** a clean flowing document with headings and bullets, keyboard-first, like Apple Notes.

**Meeting details:** title, date, attendees; optionally started from one of today's Airhead events so it links automatically.

**Saving:** every stroke or keystroke saves to the device instantly; the note syncs as a whole document a few seconds after you pause.

**Done → Summarise:** handwritten pages are rendered to images and read once by a vision model; typed notes are sent as text. The result is a transcription, short summary, decisions, and an action-item checklist you confirm before items become tasks. Everything is stored once and indexed for Ask Airhead. Reading view shows the summary above the original pages.

**Build stages:**

1. Pen, highlighter, eraser, text boxes, autosave, typed notes, Summarise.
2. Lasso select, copy, paste and move.
3. Shape snapping: hold at the end of a stroke to snap to a circle, rectangle, line or arrow (plain geometry, offline, no AI).

Fallback if the custom page stalls: Excalidraw (MIT), since stored notes are Airhead's own format.

## Today, briefs and notifications

One AI call each morning builds the day and schedules its nudges; every other notification is sent by the server scheduler with no extra AI calls.

**Today tab:** brief (a few lines) → today's events → **Top 3** shown prominently → collapsed **Also today** → suggestion cards (fuzzy events, "workshop this?", carry-over decisions).

**Morning brief:** larger model, SQL-built digest in (today, next 7 days, carry-overs, yesterday's stats, active ideas); out comes a reflection on yesterday, today's list with Top 3, a suggested time slot for each Top 3 task found in free calendar gaps ("Dentist call fits 12:30–12:45"; gaps computed in code, no extra call), and prep nudges with send times. If it fails, a code-built list is sent instead.

**Workshop (in the Inbox tab, "To flesh out"):** anything can be sent there, and sorting can suggest it. **Auto flesh-out** returns a structured draft (summary, sections, open questions, next steps). **Work on it together** asks two or three questions at a time and updates the draft; sessions save, send only the draft plus recent turns, and queue offline. Drafts keep versions and link to the original; next steps become tasks in one tap.

| Notification | When | AI cost |
| --- | --- | --- |
| Morning round-up | Chosen time, e.g. 7:30 | One daily call |
| End-of-day review (done, missed, carry over or drop) | Chosen time, e.g. 21:00 | None |
| Event reminder | 30 min before by default, per-event override | None |
| Prep nudge ("pack your training bag tonight") | Scheduled by the brief | Included in brief |
| Task reminder; slip nudge after 3+ carry-overs | Due time; morning | None |
| Weekly review ready | Chosen day, e.g. Sunday evening | One weekly call |

**Delivery rules:** iPhone only (each device registers; iPad stays silent but synced). Requires home-screen install and permission. Per-type toggles, quiet hours, a daily nudge cap that bundles extras, snooze or done where iOS allows. Scheduler granularity means a minute or two of lateness. Every notification is logged for the patterns view.

**Calendar and sharing:** Airhead has its own built-in calendar with no Google integration. Events go into **Personal** or **Us**.

- **Out:** the Us calendar is published as a private, revocable subscribe link. My girlfriend subscribes once in Apple or Google Calendar and sees Us events read-only; her app sets the refresh rate (Google can lag several hours). I can also subscribe on my own iPhone so Airhead events show in Apple Calendar.
- **In:** she shares a dedicated Us calendar from her app as a secret iCal link; I paste it into Settings → Linked calendars. Airhead polls it every 15–30 minutes and her events feed my Today view, brief and prep nudges, read-only.
- **Per-event invites:** a Share button sends a standard calendar invite through the iOS share sheet for one-offs.
- Each side edits only its own events. Both links act as keys and can be reset at any time.

**Recaps and insights:** stats (completion, carry-overs, capture and completion times, slipping task types, idea return counts) are computed in SQL for free. The weekly review adds themes, wins, what slipped, two or three organisation suggestions, the Tidy-up card and the AI spend line.

## Desktop in Chrome

The same PWA installs in desktop Chrome as its own app window and works offline there too; on a wide screen it switches to a planning layout for managing the calendar, tasks and events.

**Layout by screen size:** phone = five bottom tabs; iPad = sidebar plus one main pane; desktop = sidebar, main pane and a right-hand panel (for example Today on the left of a week view, with Inbox alongside).

**Calendar views (all devices, richest on desktop):** day, week, month and agenda, showing Personal, Us and her linked calendar in distinct colours with show/hide toggles. Built on FullCalendar's free MIT-licensed core (no paid plugins), so there is still no licence cost.

**Desktop planning actions:**

- Drag a task from the list onto the calendar to time-block it; drag events to reschedule or resize.
- Click an empty slot to create an event; edit details in a side panel rather than a pop-up.
- Bulk actions on tasks: multi-select to reschedule, complete, move to Top 3 or drop.
- Keyboard shortcuts: Ctrl/Cmd+K quick capture from anywhere, N new task, E new event, T jump to today, / search, ? shortcut list. Shortcuts only speed up actions that also have a visible button.
- Typed notes, Workshop sessions and Ask Airhead are comfortable with a full keyboard; handwritten pages are view-and-search on desktop (writing stays on the iPad).

**Capturing while browsing:** a free **"Send to Airhead" bookmarklet** saves the current page (URL, title, any selected text) in one click; paste also works anywhere in the app. A full Chrome extension goes on the later list.

**Notifications:** still iPhone only by default; desktop Chrome can be switched on per device in Settings.

**Testing:** the manual checklist adds desktop Chrome (install, offline, drag and drop, keyboard shortcuts, bookmarklet).

## Work and leave

Airhead tracks where I'm working, my annual leave against a configurable leave year, and Irish public holidays; everything is computed in code except a small AI call that writes holiday suggestions. It is a personal record; the employer's HR system stays authoritative.

**Work settings:** working days and hours per day (for half days); leave year start (e.g. 1 December to 30 November); annual leave entitlement, carry-over allowance and its expiry; separate non-deducting leave types (e.g. sick); company closure days; and how my employer handles a public holiday on a weekend (paid day off within a month, extra day of leave, or extra pay).

**Irish public holidays:** calculated on device for any year, so offline and maintenance-free: New Year's Day, St Brigid's Day (first Monday in February, or 1 February if a Friday), St Patrick's Day, Easter Monday, first Mondays of May, June and August, last Monday in October, Christmas Day and St Stephen's Day. Shown as their own calendar layer with weekends shaded. Good Friday, Christmas Eve and New Year's Eve appear as optional "common days off" markers, not holidays. One-off holidays can be added manually.

**Logging leave:** select days on the calendar or capture "AL 14–18 July"; full or half days. Only working days count (weekends, public holidays and non-working days are skipped). Status: Planned → Requested → Approved → Taken (automatic once the date passes). Leave days set work status to Off, silence work nudges, and can optionally show on the Us calendar.

**Leave counter:** entitlement plus carry-over, taken, booked, planned and remaining, with a pace check ("30% used, 70% through the year").

**Use-it-or-lose-it reminders (code, no AI):** at about 3 months, 6 weeks and 2 weeks before the leave year ends, if remaining days exceed the carry-over allowance: "7 days left; 2 carry over, 5 lost on 30 November. See suggestions?"

**Holiday suggestions:** code finds bridge opportunities (1–2 leave days next to a public holiday or weekend that give 4–5 days off), ranks them by days off per leave day, and removes clashes with my events and her linked calendar. One small AI call adds judgement (upcoming occasions, time since the last break, busy spells) and writes two or three suggestions. Runs monthly, in the weekly review when relevant, and from a "Suggest leave" button.

**Work location:** each working day is WFH, Office, Client site, Travel or Off, from a default weekly pattern with a one-tap change on Today and desktop, shown as a calendar badge.

- **Prep nudges:** a checklist per location (e.g. Office: laptop, charger, pass) sent the evening before, at no AI cost; the brief also knows the day's location.
- **Record:** days per location by week and month in Insights.
- **Sharing:** each day's location (or just "Working" / "Off", per setting) appears as an all-day item on the Us feed, so my girlfriend sees where I'll be.

## Offline and sync

The device is the primary copy; Supabase keeps devices in step and acts as the backup.

- **Records:** device-generated UUIDs, a soft-delete flag (purged after 30 days), and server-stamped change times so device clocks never decide order.
- **Push:** every change goes into a local outbox, sent in batches when online.
- **Pull:** each device fetches everything changed since its last sync.
- **Triggers:** app open, connection regained, after each capture, periodically while open; Supabase Realtime nudges the other device so changes appear within seconds.
- **Conflicts:** newest change wins per record. If a note is edited on both devices while one was offline, both versions are kept and marked "Conflicted copy"; writing is never silently discarded.
- **Files:** compressed, queued for upload, downloaded on first view and then cached offline.
- **iOS storage:** request persistent storage; the server copy means only unsynced changes are ever at risk, so sync runs as soon as a connection appears.
- **Visibility:** a status icon (synced, "3 waiting", offline) and last successful sync in Settings.

## Housekeeping and link reading

A weekly AI tidy-up reduces clutter (storage savings are a bonus), and saved links are actually read so they become useful summaries and, where sensible, actions.

**Tidy-up (inside the weekly review call, no extra call):**

1. Code finds candidates for free: completed tasks and read items past an age, past events, near-duplicates (via Ask Airhead embeddings), stale Unsorted items.
2. The AI reasons over only those candidates and proposes Keep, Archive, Condense or Delete with a one-line reason.
3. **Condense** merges related notes into one with a dated timeline of the originals and links back; originals are archived and stay searchable.
4. **Auto-approved (low risk):** completed tasks older than 90 days, read reading items older than 90 days, past events with no notes, exact duplicates. Everything else goes on the Tidy-up card; meeting notes and ideas always need approval.
5. All removals are soft and recoverable for 30 days.

**Link reading:** when online, a server function extracts the main article text (free) and computes reading time. In the next batch the small model reads a trimmed version once and returns a summary, key points, topic tags, any link to an active idea, and actions only where they make sense (an event page → suggested event, a course page → task). Only the summary and key points are stored. Paywalled, login-only and app-style pages fall back to title and description and are marked "couldn't read"; YouTube uses title and description.

## Build phases and testing

Nine phases, each leaving a usable app; the core daily loop (capture, sorting, reminders) comes before notes.

1. **Foundations:** repo, dev and live Supabase projects, sign-in, passkey app lock, installable PWA shell, deployment, keep-alive ping, weekly backup.
2. **Capture core:** local database, responsive phone, iPad and desktop layout, Capture tab, free rules (links, dates, recurrence), sync, basic Inbox and Library, on-device search, full data export. Usable offline from here.
3. **AI sorting:** AI gateway, cost logging and AI usage screen, rolling batches, brain-dump splitting, corrections, link reading, personal lists, memory facts and learned rules, memory Check-up.
4. **Calendar and notifications:** built-in calendar (day, week, month and agenda views, drag to reschedule and time-block) with the Us subscribe feed and linked-calendar import, Irish public holidays, work settings, work location and leave tracking with run-out reminders, Import schedule, iPhone push, scheduler, event and task reminders, evening review.
5. **Today and morning brief:** Top 3, Also today, prep nudges, carry-over prompts.
6. **Notes:** typed notes, notebook stage 1, Summarise and action items.
7. **Thinking tools:** iOS Shortcuts and the Chrome bookmarklet, Workshop (auto and collaborative), Ask Airhead.
8. **Reflection:** weekly review, Insights and patterns, Tidy-up, holiday suggestions, Scout with web search.
9. **Notebook polish:** lasso, copy, paste and move; then shape snapping.

**v0.1 milestone:** phases 1–4 (capture, sorting, calendar, leave, reminders) form the first usable version. Use it daily for a few weeks, then let real use set the order of phases 5–9.

**Success measures**, shown in Insights: captures per day, sorting correction rate (a rising rate means sorting needs tuning), and AI cost per month.

**Scope freeze:** from here, new ideas go to the later list unless they fix a real problem found while using the app.

**Testing:**

- Automated tests for date and recurrence parsing, sync and conflict handling, and row-level security.
- AI tests run against saved example responses (no paid calls) and check every output against its schema.
- A manual checklist for iPhone, iPad and desktop Chrome: install, offline, notifications, Pencil versus finger, Shortcuts, drag and drop, keyboard shortcuts, bookmarklet.

## Decisions and later list

| Area | Decision | Why |
| --- | --- | --- |
| Audience | Me first, multi-user-ready | Avoid a rewrite later |
| Build | Some coding, heavy Claude Code | Mainstream, well-documented stack |
| Devices | iPhone, iPad and desktop Chrome from one PWA | Plan on desktop, capture on phone, write on iPad |
| Capture | PWA + iOS Shortcuts + Chrome bookmarklet now, native wrapper later | Share sheet without App Store or Mac |
| Canvas | Custom notebook page on MIT parts | No licence cost; tldraw needs a licence in production |
| Typing | Typed notes as a second style, text boxes on pages | Comfortable long typing |
| AI timing | Free rules instant; rolling batches for the rest | Cheap without long waits |
| Calendar | Built-in calendar; auto-add when confident, ask when unsure; partner sharing by feed swap | Works offline, no Google permissions, zero setup for her |
| Data flow | Airhead is the source of truth; only linked partner calendars come in | Simpler permissions |
| Work and leave | Irish holidays computed in code; Dec–Nov leave year configurable; location shared on Us | Accurate, free, offline |
| Imports | Import schedule with review before saving | Bulk events never added silently |
| Daily list | Morning brief, Top 3 with time slots + Also today, prep nudges | Avoid overwhelming lists |
| Notifications | iPhone only | No double buzzing |
| Backend | Supabase free plan, separate dev and live projects, safeguards | Easiest setup; storage fits year one |
| Inbox | Unsorted and Workshop merged in one tab | Five tabs fit a phone |
| Brain dumps | AI splits one capture into items | More user-friendly, low cost |
| Search | Ask Airhead in v1 | Meeting notes must be callable |
| Memory | Auto-add everyday facts; approve people and personal details; learned rules | Tailored and cheaper calls, with control |
| Scout | Weekly plus on-demand, own data and capped web search, suggestions only | Proactive without nagging or surprise costs |
| Check-up | Visible button; no hidden or typed commands anywhere | Everything discoverable |
| Tidy-up | Auto-approve low risk, ask for the rest | Clutter control with safety |
| Safety | Untrusted content is data only; app lock; export everything | Protects data and avoids lock-in |

**Later list (not in v1):**

- Email scanning for appointments and work items.
- Native app wrapper (Capacitor) with a true share extension, offline share and location-based reminders (not possible in a PWA on iPhone).
- One-time import of birthdays from Google Contacts.
- Shared editable calendar inside Airhead (partner gets an Airhead login; instant two-way edits), upgrading the Us feed swap.
- Shared lists with my girlfriend (needs the same partner login).
- Long voice memo recording with paid transcription (short thoughts already use free iOS dictation).
- Full Chrome extension for capture (right-click save, screenshots of a page region), replacing the bookmarklet.

**To confirm during planning:** Supabase built-in embedding model details; current AI model prices for the price table; refresh behaviour and default alerts for subscribed calendars in Apple and Google Calendar.
