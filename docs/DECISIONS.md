# Decisions

Decisions and library versions, newest first.

## 2026-11-07 — Task 4.14 Evening review
- **`/review`**: opened by the 21:00 notification (its URL), and linked from Today. It lists today's open tasks: due today or earlier (by the person's local date), or in today's Top 3. Overdue tasks appear so they get a decision.
- **One tap each**:
  - **Done** sets `status: done` and `completed_at`.
  - **Tomorrow** carries the task over: `carry_count + 1`. A due time keeps its local time of day on tomorrow's date (an overdue 10:00 task becomes 10:00 tomorrow), and today's Top 3 place becomes tomorrow's.
  - **Drop** sets `status: dropped`.
  - **"Carry all to tomorrow"** appears for two or more tasks.
- **`carry_count`** is what the scheduler's slip nudge looks at (3 or more).
- **When the list is empty** the screen says "All done for today" with a way back to Today.
- **Changes are local first and sync like any edit.** Completing or dropping cancels the task's reminder in the database (4.12); moving the due time moves it.

## 2026-11-07 — Task 4.13 Scheduler tick
- **Dispatch**: `pg_cron` runs `dispatch_scheduler_tick()` every minute (migration `20261107000014_scheduler.sql`). It makes one `pg_net` call to `scheduler-tick` with the service key, but only when someone has a notification device and the Vault secrets are set. The function rejects any other caller.
- **Each tick, per person with a receiving device**, in their time zone (`settings.data.time_zone`, default Europe/Dublin):
  1. **Recurring event reminders**: occurrences in the next 26 hours, expanded with `rrule` at local wall-clock time, so they're right across the clock change. Each is inserted once by key `event:<id>@<occurrence>`. This is the part 4.12 left to the scheduler.
  2. **Local-time jobs**, each at most once per local day: claimed through `job_runs` by insert-if-absent; a second run gets nothing back.
     - **Evening review** at 21:00: "N open tasks today: done, carry over or drop?". Covers tasks due today or earlier, or in today's Top 3; opens `/review` (4.14).
     - **Location checklist** at 20:00 the evening before: tomorrow's location (pattern, overrides, leave, holidays) and its list, e.g. "Tomorrow: Office · Bring: Laptop, Charger, Pass". Not when off or the list is empty.
     - **Slip nudge** at 08:00: tasks carried over 3 or more times.
     - **Leave run-out** at 08:00: milestones at 90, 42 and 14 days before the leave year ends, each sent once per year (dedupe key), when remaining days are more than the carry-over allowance. Balances come from the same leave engine as the app.
     - Job nudges are inserted as pending, then sent by the same rules as everything else.
  3. **Sending**:
     - **Cancelled, never sent late**: switched-off types; stale nudges (event reminders over 2 hours late, others over 12).
     - **Quiet hours** (default 22:00–07:30, may span midnight) defer everything except event reminders, unless that is switched off. Deferred nudges stay pending and go out when quiet hours end.
     - **Daily cap** (default 8 single notifications per local day): extras are bundled into one "N more reminders" summary listing their titles. At most one summary an hour; until then extras wait. Summaries are logged as `kind = 'summary'` and don't count toward the cap.
     - Sent nudges are marked `sent` with `sent_at`, a log for the patterns view later. With no device to receive them they are marked `failed`. Gone subscriptions are cleared (4.11).
- **Settings shape**: `settings.data.notifications`, with per-type switches, quiet hours, cap, job times and the reminder default. Every field falls back to its default; 4.15 adds the screen.
- **Shared copies for the server**:
  - The app's leave engine, as `_shared/leave/engine.ts` plus `work.ts` (the same work-setting defaults and per-field fallback, without Zod).
  - The holiday rules (4.8).
  - The scheduler tests check the same balances as the app's leave tests.
- **Marking leave Taken** stays in its own nightly SQL job (4.6) rather than this tick.
- **`rrule`** is imported in Deno as the npm default export, because it is CommonJS.

## 2026-11-07 — Task 4.12 Reminder generation
- **Trigger** (migration `20261107000013_reminders.sql`): `item_reminders` runs after insert, or after updates to the columns that matter, on `items`. It runs in the database, so reminders exist once the item has synced, whichever device made it.
- **Event reminder** (`event:<id>`): `start_at − N minutes`.
  - N is the event's `data.reminder_minutes` (a number, or `"none"`), else `settings.data.notifications.event_reminder_minutes`, else **30**.
  - Body: "In 30 min · 15:00 · Smile Clinic", in the person's time zone. Opens `/calendar`.
  - Timed, open, non-recurring events only. All-day events get no timed reminder; suggestions get none until accepted.
- **Task reminder** (`task:<id>`): at `due_at`, "Due: …", opening the item.
- **Time-TBC check** (`tbc:<id>`): for all-day events with `data.time_tbc` (from imports), 10:00 local, 7 days before: "Time confirmed yet? …".
- **Changes**:
  - **Moving** the item moves its nudge. A nudge that was already sent is armed again only when its send time actually changes, so editing a title doesn't resend it.
  - **Completing, dropping or deleting** the item cancels pending nudges. So does switching the reminder to "none", or making the event recurring.
  - **A reminder whose time has already passed** isn't created; a pending one is cancelled rather than sent late.
- **Recurring events** are left to the scheduler (4.13), which has the recurrence code and plans their next occurrence.
- **Applied when sending, not stored here**: quiet hours, the daily cap and per-type switches (4.13/4.15).
- **Helper functions** `upsert_nudge`, `cancel_nudge` and `user_time_zone` are security definer and not callable by devices.
- **Event editor**: a **Reminder** choice (default, none, at the start, 10 or 30 minutes, 1 or 2 hours, 1 day) writes `data.reminder_minutes`. "Default" removes the override and keeps the rest of `data`.

## 2026-11-07 — Task 4.11 Push setup
- **Library**: `jsr:@negrel/webpush@0.5.0`, Deno-native Web Push on WebCrypto (RFC 8291 aes128gcm, RFC 8292 VAPID).
  - Chosen over npm `web-push`, whose Node crypto calls are a poor fit for Edge Functions.
  - Verified from the package source: `importVapidKeys` (JWK), `ApplicationServer.new`, `subscribe(sub).pushTextMessage`, and `PushMessageError`.
- **VAPID secrets** in Supabase only: `VAPID_KEYS` (the JWK pair as JSON) and `VAPID_SUBJECT`.
  - `scripts/generate-vapid-keys.ts` makes them on your machine (BLOCKERS item 10).
  - The app fetches the public key from `GET send-push`, so no client env variable is needed.
- **`send-push`** (`verify_jwt = false`, checks callers itself):
  - `GET` → `{ public_key }`.
  - `POST {mode:'test', device_id}` from the device's owner → a test notification to that device.
  - `POST {user_id, payload}` with the service key → that user's notification devices (used by the scheduler in 4.13).
  - Push service answers 404 and 410 clear the device's `push_subscription`. Messages use urgency high, a 6-hour TTL and an optional topic, so a newer message replaces an older one.
- **Settings → Notifications**:
  - Permission is requested only when "Turn on notifications" is tapped. On iPhone or iPad outside the Home Screen app, it explains Share → Add to Home Screen instead of trying.
  - The subscription is stored on this device's row and synced.
  - **Which device gets them**: the first device turned on, but an iPhone takes over from a non-iPhone device (iPhone by default). "Send them here instead" moves them. "Turn off on this device" unsubscribes the browser and clears the row.
  - "Send test notification" pushes the device row first, so the server sees the subscription.
- **Service worker**:
  - `push` shows the title and body, with the app icon and badge, tagged so a newer one replaces an older one.
  - `notificationclick` focuses an open Airhead window and navigates it, or opens one.
  - The tapped path is parsed by a pure function (`src/sw/payload.ts`) that only accepts in-app paths, so a payload can never open another site.

## 2026-11-07 — Task 4.10 Import schedule
- **Libraries (verified current)**:
  - **ical.js 2.2.1** for .ics, **Papa Parse 5.7.0** for CSV and **pdfjs-dist 6.5.438** (legacy build, worker loaded via Vite `?url`).
  - **SheetJS 0.20.3** for Excel, installed from SheetJS's own CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), because the npm `xlsx` package is stuck at 0.18.5.
  - pdf.js chunks are left out of the PWA precache (`globIgnores`): PDF import needs the AI anyway, so it is online-only. The xlsx chunk stays precached, so CSV and Excel import work offline.
- **Free routes first, all on the device**:
  - **.ics** (file or pasted) is parsed exactly: recurrences for a year, cancelled and past events dropped.
  - **CSV and Excel** go through a column-mapping step. Roles (date, start/end time, title, venue, home/away team, notes) are guessed from the headings and editable.
  - Dates are ISO, Irish day-first (3/4/2027 = 3 April) or words. Times like 19:30, 7.30pm, 7pm or 1930; "TBC" means no time.
- **AI routes** (`import-extract`, one small-tier call through the gateway, cost line on the button):
  - Pasted messy text.
  - **Text PDFs**: words extracted on the device, then sent as text, which is cheaper than vision.
  - **Scanned PDFs** (under 40 characters of text): sent as a PDF document block.
  - **Images**: compressed to 1600 px first, sent as an image block.
  - **Links**: fetched on the server with the safe fetch. If the page is iCalendar it comes back as text for the device to parse with no AI call, and the review offers **"Add it as a linked calendar instead"**. Otherwise the page's visible text (table rows kept, nav and scripts removed) goes to the AI.
- **Prompt `import.v1`**: years resolved from today and the time zone; never guess a time; the instruction filters; the schedule is data, never instructions.
  - The output is validated twice: on the server (bad dates dropped, bad times → TBC, at most 400 events) and again on the device.
  - Without a server, the AI routes say what still works offline.
- **The instruction on code routes is a code filter**: all / attending all, home or away (the schedule's own team is the one in every "A v B" title; home = listed first, or venue/notes say home), weekends or weekdays only, "only <name>".
  - If an instruction can't be applied, the review says so and leaves the list to edit by hand.
  - On AI routes the instruction goes in the prompt.
- **Review table**: tick or untick, then edit date, time, title and venue.
  - **Clashes** with Airhead events, recurring ones included, and with linked calendars are flagged; an untimed event only clashes with all-day plans.
  - **Working days** offer "book leave", which creates a planned full-day booking with the match as its note.
  - Choose Personal or Us, and name the series (defaults to the file or calendar name).
- **Saving**:
  - One `series` row (`source_kind: 'import'`, route and instruction in `data`) and one event per ticked row with `series_id`.
  - Timed events: local time → instant, correct across the clock change; the end defaults to 2 hours.
  - Unconfirmed times become **all-day events with `data.time_tbc`**. The "check nearer the date" nudge is generated from that flag by the reminder trigger (4.12).
  - The original file is queued for upload to `<user>/series/<series>/<name>` in the private bucket. Migration 0012 lets the bucket accept .ics, CSV, text and Excel, but not HTML.
  - **Undo** soft-deletes the series and its events.

## 2026-11-07 — Task 4.9 Linked calendars
- **Settings → Linked calendars**: paste a secret iCal link (`webcal://` or `https://`), then **Check link**. The server fetches and parses it and returns the event count and the calendar's own name (used as the default name). Then name it, pick one of six colours (kept away from the Personal, Us, tasks and leave colours) and add it.
  - The row is pushed, the server is asked to read it straight away, then devices pull.
  - Each row shows the **host only**, never the secret path, plus the last update or the last error. Rows can be switched off, refreshed or removed.
  - Local mode says it needs a server.
- **`fetch-linked-calendars`** (Edge Function, checks the token itself):
  - `{ mode: 'validate', url }` for a signed-in user stores nothing.
  - `{ mode: 'sync', feed_id? }` comes from the scheduler (service key) or from the owner for their own feed.
- **Scheduler**: `dispatch_linked_calendars()` runs every 30 minutes (`pg_cron`). It makes one `pg_net` call per enabled, live linked feed, so one slow or broken calendar can't hold up the others. Without the Vault secrets it sends nothing.
- **Safe fetch**: the link-reading `safeFetch` gained options. `ICS_OPTIONS` accepts `text/calendar`, `text/plain`, `application/octet-stream`/`ics` (servers label .ics loosely), with a 5 MB cap. The same private-address, redirect and timeout rules apply. The body must start with `BEGIN:VCALENDAR`, so a sign-in page is rejected with a plain message.
- **Parsing** (ical.js 2.2.1):
  - VTIMEZONEs are registered.
  - Recurrences are expanded from 30 days back to 12 months ahead, with EXDATEs and moved instances (`RECURRENCE-ID`) applied. Cancelled events are skipped.
  - At most 800 occurrences per event, so a runaway rule can't flood the table. Text fields are clipped to 2,000 characters.
- **`occurrence_key`** = UID, or `UID|original start` for recurring events, so a moved instance keeps its row.
- **All-day dates are stored at 12:00 UTC** with an exclusive end, so the date reads the same in any zone within ±11 hours.
- **Keeping events in step**: rows are upserted by `(feed_id, occurrence_key)`, which revives soft-deleted rows. Keys no longer present are soft-deleted, so devices hear about removals.
- **On failure** the old events stay and `last_error` is set; success clears it and stamps `last_fetched_at`.
- **Calendar content is data only**: it is stored for display, never sent to AI and never learned from. The fixture includes an "ignore all previous instructions" description to show it is just stored text.
- **Removing a linked calendar** soft-deletes the feed. Devices hide its events at once; the nightly purge later removes the feed and, by cascade, its events.

## 2026-11-07 — Task 4.8 Outgoing feeds
- **Tokens are made on the device**: 32 random bytes, base64url (43 characters).
  - Only the hex SHA-256 goes into `feeds.token_hash`, so creating or renewing a link works offline and the link can never be read back from the server.
  - The link is shown once (copy, or "Subscribe on this device" via `webcal://`). "New link" replaces the hash on the same feed; "Turn off" soft-deletes it.
  - Both take effect once the change syncs.
- **`calendar-feed?t=<token>`**: a public GET (`verify_jwt = false`; calendar apps can't sign in).
  - It hashes the token and looks the feed up by hash with the service key, always filtered to the owner.
  - Unknown, revoked or switched-off feeds, and `linked_in` rows, all return the same 404.
  - Responses are `text/calendar` with `cache-control: private, max-age=300`. The calendar sets `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` to one hour (apps choose their own rate; Google can lag hours).
- **Contents**:
  - **`us_out`**: open Us events (title and location; never notes), leave marked "share to Us" as all-day **Off** ("Off (morning)"/"(afternoon)" for a half day), and each working day's location from 14 days back to 120 ahead.
    - Location sharing follows the Work setting: WFH, Office, … / just "Working" / nothing.
    - Location markers are `TRANSP:TRANSPARENT`, so they don't block free/busy.
    - Leave days, holidays, closures and weekends get no location marker.
  - **`me_out`**: open events from both calendars (with notes), time-blocked tasks ("Task: …"), all leave with type and status, and full locations.
- **Stable UIDs**: `<item id>@airhead`, `leave-<id>@airhead`, and `loc-<user prefix>-<date>@airhead`. Edits update in place in subscribers.
- **Recurring timed events**: written with `DTSTART;TZID=<time zone>` plus a VTIMEZONE (GMT/IST rules for Dublin/London), so a weekly 19:00 stays at 19:00 after the clock change (checked through ical.js). Non-recurring timed events use UTC. All-day events use `VALUE=DATE` with an exclusive end.
- **Hand-written iCalendar writer** (`_shared/ics.ts`): escaping and 75-octet UTF-8-safe folding, no library on the server. Tests round-trip it through **ical.js 2.2.1** (current) as the plan asks.
- **Shared copy of the holiday rules**: `_shared/holidays/` is a copy of `src/lib/holidays/` with `.ts` import paths, because the function bundle can't import from `src`. A Deno test checks the same dates as the app's tests, and the header says to keep them in step. The work-setting defaults the feed needs are mirrored in `readWork`.
- **Deno runs locally now** through `npx deno@2.9.6` (the npm package ships the binary). The full function suite passes locally before CI, with the same flags as CI.

## 2026-11-07 — Task 4.7 Work location
- **Where today's location is set**:
  - **Today**: a "Today: Office" chip that opens one-tap choices (WFH, Office, Client site, Travel, Off); the weekday's usual place is marked "(usual)".
  - **Desktop**: the same control in the right-hand side panel.
  - **Calendar**: the badge was added in 4.2.
- **On a full leave day the chip is disabled ("on leave")**, because leave wins. On a public holiday an override is allowed (working a bank holiday).
- **One row per day across devices**: `work_days` rows use a **deterministic id per user and date** (`workDayId`, a 128-bit cyrb128 hash shaped as a UUID with version nibble 8). Two devices setting the same day update one row instead of clashing on `unique (user_id, date)`.
- **Choosing the usual place soft-deletes the override**, so later changes to the weekly pattern apply again. Choosing another place revives the same row.
- **Insights → "Where I worked"**: days per location by week (last 8, Monday start) and by month (last 6), up to today. Only working days count; columns appear only when used. Computed on the device from the same `locationFor` as the calendar (no SQL needed).

## 2026-11-07 — Task 4.6 Leave UI
- **Ways to book leave**:
  - **Calendar**: select a range (all-day) → the event editor offers **Book as leave**, which opens the leave sheet with the dates filled in.
  - **"Book leave" buttons** on the calendar toolbar and the new **Work and leave** screen (`/work`).
  - **Tapping a leave block** on the calendar opens the booking.
- **The leave sheet** (`src/features/leave/LeaveSheet.tsx`):
  - Dates, plus half days: one select for a single day (full / morning off / afternoon off); "first day starts at midday" and "last day ends at midday" for ranges.
  - Type from the work settings, status (Planned → Requested → Approved → Taken), "Show as Off on the Us calendar" (used by the feed, 4.8) and a note.
  - A live cost line: "Uses 4 days of leave · 17 days left after this", or "not taken from your annual leave" for non-deducting types.
- **`saveLeave`** caches `days` (the engine's count) on the row, clamps an end before the start, and never sets both halves on one day.
- **Capture rule** (`src/lib/leave/parse.ts`): "AL 14–18 July", "annual leave 3 Aug", "A/L 1 March", "day off Friday", "sick 2-3 March" and "half day AL Friday (afternoon)".
  - The date must follow the leave words straight away, so "Leave for the airport Friday" is not leave.
  - A time means it's not leave.
  - Instead of an event, the capture gets `payload.leave_proposal` (sorted, chip "Leave to book (Today)"). Today shows a card: **Book as planned** (links the booking) or **Dismiss**. It never books on its own, as the plan says "proposes".
- **Leave counter**:
  - Today: a compact card linking to `/work`.
  - Work screen: the full breakdown (entitlement, extra days, carry-over, expired, taken, booked, planned, remaining), the pace line, and warnings for carried-over days at risk and days that would be lost at year end.
  - The Work screen lists bookings for this and next leave year and edits the year's opening carry-over (blank = work it out).
- **Leave sets the location to Off**: `locationFor` already returns Off for full leave days (4.2). Silencing work nudges belongs to the scheduler (4.13), which will use the same check.
- **Nightly Taken job** (migration `20261107000010_leave_taken.sql`): `mark_leave_taken()` at 01:10 UTC turns requested or approved bookings whose last day has passed (in each person's `settings.data.time_zone`, default Europe/Dublin) into Taken.
  - Planned bookings are left alone, because they were never asked for.
  - It only updates `status`/`updated_at`; the sync trigger stamps `server_updated_at`, so devices pull the change.

## 2026-11-07 — Task 4.2 Calendar views
- **Verified: FullCalendar 7.1.4 (MIT) is current.**
  - The plugins now ship inside `@fullcalendar/react` (`/daygrid`, `/timegrid`, `/list`, `/interaction`), with themes as plugins (`/themes/classic` plus its CSS).
  - `temporal-polyfill` 1.0.8 is a required peer.
  - The v6 packages (`@fullcalendar/core`, `/daygrid`, …) must not be installed alongside.
  - Breaking changes used here, from the upgrade guide: `headerToolbar` is off by default, `dayCellContent` → `dayCellTopContent`, `slotLabelFormat` → `slotHeaderFormat`, no `fc-*` class names, and callback dates are still `Date`.
- **No `@fullcalendar/rrule` plugin.** Recurring items are expanded in `src/lib/calendar/sources.ts` with the `rrule` library already used for parsing.
  - It works on floating wall-clock times in the person's time zone, so a weekly 19:00 stays at 19:00 across the clock change (unit-tested over 25 October 2026).
  - This one function will also serve the feed (4.8) and reminders.
  - Recurring occurrences are not draggable: an occurrence edit would need exception dates. Editing one opens the series.
- **Sources and colours**:

  | Source | Colour |
  | --- | --- |
  | Personal | indigo |
  | Us | rose |
  | Time-blocked tasks | amber |
  | Public holidays | slate; common days off lighter |
  | Leave | green |
  | Each linked calendar | its own colour, or teal |

  Show/hide toggles are per device (`localStorage`, wrapped in try/catch).
- **Linked events, holidays and leave are read-only on the calendar.** Leave is edited in the leave sheet (4.6).
- **All-day items** store local midnight of the first day and, for multi-day items, of the last day (inclusive, matching the capture rules). FullCalendar's exclusive end is derived.
- **Views**:
  - Day (timeGridDay), Week (timeGridWeek, desktop default), Month (dayGridMonth), Agenda (the next 14 days, phone default).
  - Weeks start on Monday, with a 24-hour clock.
  - Our own toolbar, because v7's is off by default and ours fits the app's styling.
  - Timed views have a fixed height scrolled to 07:00.
- **Work-location badge**: in day headers (day and week views) and day cells (month view). It is Off on leave, holidays, closures and non-working days, so it is hidden there.
- **Interactions**:
  - Selecting an empty slot opens the editor; a single 30-minute slot becomes an hour.
  - Drag and resize write `start_at`/`end_at`/`all_day` through `movedTimes`.
  - Tasks with no time are listed in a "Tasks to plan" tray (tablet/desktop) using FullCalendar's `Draggable`. A drop sets a 30-minute block (`create: false`, so the item itself is the only event).
  - The editor is a side panel on tablet/desktop and a bottom sheet on phone. For a time-blocked task it offers "Remove from calendar" instead of Delete.
- **Navigation**: Calendar is a sidebar entry after Today, and a header button on the phone, so the five phone tabs stay as designed. `Page` gained a `wide` option for full-width screens.
- **Tests**:
  - Unit tests for the source mapping: time zones, DST, all-day ranges, filtering, linked feeds, holidays, leave, locations, moves.
  - Playwright (local mode, fixed clock): create from a slot then drag to another day, and drag a seeded task onto the week. Slot positions are measured once the grid stops moving.

## 2026-11-07 — Task 4.5 Leave engine
- `src/lib/leave/engine.ts`: pure functions over YYYY-MM-DD strings, with calendar arithmetic in UTC, so no time zone can move a day.
- **Leave year**: from the configured MM-DD to the day before it, a year later.
- **Counting**:
  - A day costs leave when it is a working weekday and not a public holiday, a manual one-off or a closure day.
  - Christmas Eve and New Year's Eve do cost leave, because they are not statutory days.
  - Half days: `start_half` (from midday) and `end_half` (until midday). A one-day booking with either flag is half a day. A half flag on a non-working day costs nothing.
  - A booking that crosses the leave-year boundary is split, each year counting only its own days.
- **Buckets**:
  - `taken` = status taken, or requested/approved with the last day passed. The nightly job also marks these Taken; this keeps the counter right before it runs.
  - `booked` = requested or approved.
  - `planned` = planned.
  - Remaining = total − all three.
- **Closure days**:
  - Always skipped when counting a booking.
  - When `closure_uses_leave` is on, each one on a working, non-holiday day is deducted once: taken if past, booked if not.
- **Weekend holiday compensated with leave** (`extra_leave`): +1 to the year's total for each statutory holiday on a non-working day inside the leave year.
- **Carry-over**:
  - The hand-entered `opening_carry_over` for the year wins.
  - Otherwise it is the previous year's remaining days, capped at `carry_over_max`, computed recursively (max 10 years). It is only counted when that year has bookings or an opening balance; with no history there is no carry-over.
  - Carried days are used first. Any not used by the expiry date (year start + N months) are `carry_over_at_risk` before that date, then `carry_over_expired`, which leaves the total.
- **Pace**: taken ÷ total vs days of the leave year gone, as whole percentages.
- **`lose_at_year_end`**: remaining − carry-over allowance. The run-out reminders (4.13) use it.
- The per-booking `days` cached on `leave_bookings` will be `countLeaveDays` over the whole booking (4.6).

## 2026-11-07 — Task 4.4 Work settings
- **Where they live**: `settings.data.work`, so they sync with the settings row. Schema: `src/lib/work/settings.ts`.
- **Every field has a default**. `readWorkSettings` falls back field by field, so one bad value never resets the rest.
- **Defaults**:
  - Mon–Fri, 7.5 hours a day; leave year from 1 December.
  - 21 days' entitlement (Irish statutory minimum is 4 working weeks; 21 is a common contract figure, editable).
  - Carry-over of up to 5 days, expiring 3 months into the new year.
  - A public holiday on a non-working day gives a paid day off.
  - Closure days do not use leave.
  - Leave types: Annual (deducts), Sick, Other.
  - Location pattern: Office Mon/Tue/Thu, WFH Wed/Fri.
  - Office checklist: Laptop, Charger, Pass.
  - The Us feed shows the full location.
- **Leave year start is limited to days 1–28**, so it exists in every month.
- **`opening_carry_over`** (per leave-year start date) is in the schema for the first year Airhead is used. It is edited from the Work screen in Task 4.6, where the leave year is known.
- **Leave types are keyed by a slug of their name**. Annual leave always deducts and cannot be removed.
- **The form keeps a draft until "Save work settings"** (one settings write). It is keyed on the stored work object, so a change synced from another device resets it.
- **Checklist lines are trimmed and blank lines dropped on save.**

## 2026-11-07 — Task 4.3 Irish public holidays
- Built before 4.2 (calendar views): it is pure logic with no dependencies, and the calendar view needs it as a layer.
- `src/lib/holidays/easter.ts`: anonymous Gregorian computus, plus UTC-only date helpers (`addDays`, `weekday`, `isoDate`) so no time zone can shift a date.
- `src/lib/holidays/ie.ts`:
  - **The nine statutory days, plus St Brigid's Day from 2023**: first Monday in February, or 1 February when that is a Friday.
  - **The one-off 18 March 2022 holiday**: it was a real public holiday, so a past leave year counts correctly.
- **Weekend holidays are not moved**: under Irish law a holiday on a non-working day gives a day off within a month, an extra leave day or extra pay (Organisation of Working Time Act). That is the Task 4.4 setting, not a different date.
- **Common days off**: Good Friday, Christmas Eve and New Year's Eve are returned as `kind: 'common'`. They are not days off for leave counting unless added manually.
- **Manual one-offs** from settings are merged into their year; a date that is already a public holiday is not repeated.
- **Checked against Citizens Information**: the 2026 and 2027 lists in the tests match its published dates.

## 2026-11-07 — Task 4.1 Calendar tables
- **Migration number**: the plan says "0004", but 0004–0008 already exist, so this is `20261107000009_calendar.sql`.
- **Who writes what**:
  - **Device-written and synced both ways** (own-rows RLS for every action): `series`, `feeds`, `work_days`, `leave_bookings`.
  - **Server-written, synced to devices read-only**: `external_events`. Authenticated users get select only; the sync engine only ever pulls it, because devices never queue it.
  - **Server only**: `nudges` and `job_runs`. The owner may read them; they are not synced to devices yet. The notifications tasks decide whether the device needs them.
- **Feeds**:
  - One table for all three kinds: `us_out`, `me_out` and `linked_in`.
  - Outgoing feeds store only `token_hash`, a hex SHA-256 checked by a constraint and uniquely indexed. The device can make the token itself (32 random bytes), so creating a feed works offline.
  - A linked calendar stores its secret URL, which the server-side fetch needs.
- **External events**: one row per occurrence, with recurrences expanded on the server. `occurrence_key` = iCal UID + recurrence id/start, unique per feed. Events that disappear from the source are soft-deleted, so devices hear about them.
- **Work days** hold only the days that differ from the weekly pattern.
  - `unique (user_id, date)`.
  - Devices will use a deterministic id per user and date (Task 4.7), so two devices can never push conflicting rows.
- **Leave bookings**:
  - `start_half` / `end_half` mark half days.
  - `leave_type` is a key into settings.
  - `days` is the deducted working days, computed on the device and cached for the SQL jobs. Postgres `numeric` can come back as a string, so the Zod schema coerces it.
- **Nudges** have a `dedupe_key` (`unique (user_id, dedupe_key)`) so the reminder trigger can regenerate them without duplicates, plus a partial index on pending `send_at`.
- **`job_runs`** has primary key `(user_id, job, local_date)`. `claim_job(user, job, date)` (security definer, not callable by users) returns true only for the first claim. The nightly purge drops `job_runs` older than 90 days and covers the new soft-delete tables.
- **Dexie v4** adds the five synced tables.

## 2026-11-07 — Task 3.10 Memory Check-up
- **"Run check-up"** in Settings → Memory and on Insights runs free code checks (`src/lib/memory/checkup.ts`):
  - **profile size**: active facts over ~400 words; fix: archive the least used overflow;
  - **near-duplicate facts**: Jaccard similarity ≥ 0.8 on meaningful words, ignoring case, punctuation and filler; fix: merge, keeping the fact with more meaningful words, the first on a tie;
  - **facts unused for 90+ days**: fix: archive;
  - **facts waiting for approval**: fix: open Settings;
  - **switched-off rules**: fix: delete;
  - **rarely used rules** (≤ 5 hits after 60 days): fix: switch off;
  - **average input tokens per AI task**, last 30 days vs the 30 before, flagged at more than 25% growth;
  - **sync backlog** (> 50 waiting, or no sync for a day): fix: sync now.

  Each finding has a one-tap fix, and fact fixes show an **estimated saving**: words trimmed from every call, and euros a month = words × 4/3 tokens × last 30 days' calls × the small model's cache-read price × `eur_rate`, from the **current price table** (the profile sits in the cached prefix).
- **Not built**: a storage check (the database's 500 MB lives on the server; the device check would only see browser storage) and a separate cost-trend finding (AI usage already shows the projection). Both go to the later list if real use asks for them.
- **"Check for contradictions"** (online only): **`check-contradictions`** Edge Function, prompt `contradictions.v1`, one small-tier call over active facts, through the gateway (logged and capped). The reply is validated (`validConflicts`): exactly two different real fact ids, each pair once. The UI offers **Use "merged text"** (when given), **Keep the first** or **Keep the second**; the other fact goes to the Trash.
- **Monthly code-only run**: Insights runs the check-up by itself when the last one is over 30 days old, stores `{ at, findings }` in the device's `meta`, and shows "Last check-up: …". Kept per device, not synced. A run cut short by the database closing (sign-out) is dropped quietly.

## 2026-11-07 — Task 3.9 Memory and learned rules
- **Tables** `memory_facts` (text, category everyday/person/personal, status active/pending_approval/archived, source capture, last_used_at) and `learned_rules` (pattern, match_kind, result `{ type, list_id, calendar }`, hits, enabled; unique per user + kind + pattern). Both are synced to devices (Dexie v3) with the standard RLS, Realtime and 30-day purge (`purge_soft_deleted` now includes them), and are included in exports.
- **Facts from sorting**:
  - The sort batch (prompt **`sort-batch.v3`**) returns `proposed_facts` per capture. The planner keeps them **only from typed captures**: web-page captures are dropped, so an injected "remember that…" in a page creates nothing. It caps them at 3 per capture and 200 characters.
  - `add_memory_facts()` (service role) skips duplicates case-insensitively. `everyday` → `active`; `person`/`personal` → `pending_approval`.
- **Core profile**:
  - Contents: active facts, most recently used first (then newest), up to **~400 words** (`_shared/memory.ts`).
  - Sent as a **second cached system block** after the fixed instructions. The gateway now accepts several system blocks, each its own cache breakpoint (max 4), and drops blank ones.
  - Facts that were sent get `last_used_at = now`.
  - Relevance-based selection (embeddings) comes with Ask Airhead in Phase 7, per the design.
- **Archiving**: `archive_stale_facts()` nightly (`pg_cron` 03:41 UTC) archives active facts unused for 180 days (`last_used_at`, else `created_at`).
- **Learned rules**:
  - `learn_rules()` runs after each batch. Its unit is a capture's first word, lower-cased with punctuation stripped, at least 3 letters, and not a filler word.
  - A rule is created when that word led, ≥ 4 times, to sorted text captures with **exactly one item**, **no correction**, **always the same result** (type, list, calendar), and none were rule-sorted already. The rule is a prefix rule.
  - **On the device**, `createCapture` applies an enabled matching rule after the free rules (only when there's no link, no date and no photo). The capture is `sorted` with `payload.rule_id` (chip "Sorted (learned rule)"), and the item comes from the rule; list entries drop the prefix word ("buy oat milk" → "Oat milk"). The rule's `hits` +1. Works offline; no AI call.
  - **A correction against a rule-sorted item switches that rule off** (in `changeItemType`).
- **UI**:
  - Settings → **Memory**: "Waiting for your OK" (Remember / Forget), "What Airhead knows about me" (edit, delete, add with a kind), Archived (Restore), and **Learned rules** with on/off switches and use counts.
  - Inbox → Needs a tap also shows **one-tap cards** for facts waiting for approval (Remember / Don't remember).

## 2026-11-07 — Task 3.8 Success measures
- **Insights → Success measures** (top of Insights), three tiles:
  - **Captures per day**: non-deleted captures in the last 30 days ÷ 30. Computed on the device.
  - **Sorting correction rate**: corrections ÷ items sorted from captures (items with a `capture_id`), both over the last 30 days, shown as a percentage with "n of m" and the note that a rising rate means sorting needs tuning. Zero when nothing was sorted. Computed on the device.
  - **AI cost per month**: totals for the last 3 calendar months (Europe/Dublin), empty months included, from the server's usage log; "shown once connected" in local mode.

## 2026-11-07 — Task 3.7 AI usage screen
- **Insights → AI usage** (online only: the usage log lives on the server; local mode explains this). Shows:
  - month-to-date spend (calendar month in the user's time zone, failed attempts included) and the number of calls.
  - **projected month-end = month-to-date ÷ days elapsed × days in month**.
  - the monthly limit, a daily bar chart, a by-task table and an editable price table.
  - the note that these are estimates and **the Claude Console is the true record**.
- **Chart** (following the data-viz method): one series → one hue (indigo 600 / 400 in dark), no legend (the title names it). Thin bars with 4px rounded tops on the baseline, 2px+ gaps, a recessive axis showing only the first and last day, a hover tooltip with hit targets wider than the bars and the rest dimmed, and a **Show as table** view. Hand-built SVG; no chart library.
- **Monthly limit** is saved locally to `settings.data.ai_monthly_cap_eur` (empty/0 = none) via `updateSettingsData` (settings row id = user id) and reaches the gateway through sync.
- **Prices**: edits are upserted as the user's own `ai_prices` row (`onConflict: user_id,model`); the user's row is shown in place of the default and marked "(yours)".
- `estimateCost(rows, task, fallback)`: average cost of the last 10 successful calls of that task, else the fallback, for the cost labels on on-demand buttons (Workshop, briefs) in later phases.
- New `Services.usage` (Supabase: `ai_usage_mine` view + `ai_prices`).

## 2026-11-07 — Task 3.6 Lists
- **Library → Lists** (`/library/lists`): list chooser, **Create**, **Rename**, **Move up / Move down** (visible buttons instead of drag, which also works on touch), add entries (Enter), tick off (`status: done`, `completed_at`), **Clear completed** (soft delete: recoverable from Trash). Entries show open first, then done.
- **Default Shopping list** is created when Lists first opens. Its id is derived from the user id (`5b0f0000-` + the rest of the user id), so two devices creating it offline write the same row instead of two lists.
- **Unknown list from sorting**: Inbox → Needs a tap shows "For a list called 'Packing', which doesn't exist yet" with **Create list 'Packing'**. It creates the list, or reuses one with that name case-insensitively, and files **every** waiting entry proposed for it. The other type buttons remain for "not a list entry".
- The Library's All tab now leaves list entries out (they live on Lists); they still appear when the type is asked for explicitly.
- **Fix**: settling an unsure item now changes its type and status in **one** write (`changeItemType(..., { status: 'open' })`). Two writes left a moment where a re-typed item still read as unsure, visible to tests and to other devices mid-sync.

## 2026-11-07 — Task 3.5 Link reading
- **When**: an `AFTER INSERT` trigger on `captures` (`kind = 'link'`) `pg_net`-POSTs `{ capture_id }` to **`read-link`** with the Vault-stored service key, i.e. "after a link capture syncs", whatever its source (app, Shortcut, bookmarklet). No Vault secrets → nothing happens. The owner may also call it with their token.
- **Safe fetch** (`read-link/safeFetch.ts`, shared later by linked calendars):
  - `http`/`https` only.
  - Every hop's host is checked. `localhost`, `*.local` and IP literals in private, loopback, link-local (incl. 169.254.169.254 metadata), CGNAT, multicast, reserved, IPv6 ULA/link-local and IPv4-mapped ranges are rejected, and hostnames are resolved (A + AAAA) with *all* answers required to be public.
  - At most 3 redirects (followed manually, each re-checked), a 10 s timeout, a 2 MB cap enforced while streaming, and HTML only.
  - Network failures return a status; they never throw.
  - Known limit: DNS can change between the check and the connection (rebinding); accepted for a personal app.
- **Extraction**: **@mozilla/readability 0.6.0** on **linkedom 0.18.15**.
  - Title = `og:title`, else the page's `<h1>` when `<title>` is "Headline | Site", else `<title>`. Description = `og:description`/meta description.
  - **Readable** = at least 120 words of article text, and not a paywall teaser (paywall phrases with under 400 words). Reading time is words ÷ 230, rounded, minimum 1. Up to **3,000 words** of text are stored as `payload.article_text`.
  - YouTube/Vimeo are `title_only`. Anything unreadable, blocked or failed is `unreadable` ("couldn't read"), with title and description when known.
- **Stored on the capture**: `payload.link = { status, title, description, word_count, reading_minutes, fetched_at }`, `payload.article_text`, `payload.summary_pending` (true only when readable). The reading item gets `description`, `reading_minutes`, `couldnt_read`, and the page title if it was still the bare URL. A race where the item hasn't synced yet is harmless: the next sort batch writes the summary onto it.
- **Summaries in the next sort batch** (prompt now **`sort-batch.v2`**):
  - Pages waiting for a summary share the batch's 20 slots, with their text inside an `<article>` block (escaped like captures). The model returns `link_summary { summary, key_points, topics }` and an action only when the page clearly calls for one.
  - **Actions from a page are always `suggested`** (`data.from_link`), whatever the model's confidence: untrusted content never acts automatically.
  - `apply_sort_batch` v2 (new migration) merges the summary, key points and topics into the reading item, then **clears `article_text`** and sets `summary_pending` false. Link captures keep their own status.
- **App**: a reading item's page shows the reading time, summary and key points, or "Couldn't read this page" with the description, or "will be read and summarised soon".

## 2026-11-07 — Task 3.4 Review and corrections
- **Inbox → Needs a tap** lists unsure items from AI sorting (status `suggested`, not events) with one-tap choices: **Keep as <type>** (confirms; no correction recorded) or any other sortable type (re-sorts via `changeItemType`, which records a correction `{ type: old } → { type: new }`). Either way the item becomes `open`.
- When a `needs_review` capture has no unsure items left, it becomes `sorted`. `needs_review` captures no longer appear in Unsorted (their items are shown instead); Unsorted is `unsorted` + `failed`.
- Date suggestions (unsure events, from free rules or AI) keep their home on **Today**.
- **Corrections feed the next batch**: `sort-batch` already sends the last 5 corrections with the capture text they were about (Task 3.2), and the prompt tells the model to follow past corrections.

## 2026-11-07 — Task 3.3 Batch triggers
- **Device**: `SortProvider` (inside sync) runs sorting **once when the app opens** if any local capture is `unsorted`, and on demand from a visible **Sort now** button in Inbox → Unsorted. Each run = sync (push offline captures first) → `sort-batch` → sync (pull the new items). Offline: no call, just a plain message. Not present in local mode.
- **Server**: `pg_cron` job `dispatch-sort-batches` every 5 minutes runs `dispatch_sort_batches()`, which `pg_net`-POSTs to `/functions/v1/sort-batch` with the service key and `{ user_id }` for each user returned by `users_due_for_sorting()`:
  - due = unsorted captures with text or a link (not deleted) ≥ `settings.data.batch_threshold_count` (default 5), **or** the oldest waiting ≥ `batch_threshold_minutes` (default 60).
  - Both functions are service-only.
- **Vault**: the dispatcher reads `project_url` and `service_role_key` from `vault.decrypted_secrets`; with either missing it does nothing (returns 0). The user creates them once per project with `vault.create_secret` (BLOCKERS), so no key is in a migration or the repo.
- The app calls the function through `supabase.functions.invoke` with the user's token; non-2xx responses still carry `{ ok, error_code, message }`, which the Inbox shows as is (e.g. the cap message).

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
