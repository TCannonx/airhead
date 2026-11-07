# Airhead — manual device checklist

Things automated tests can't prove: real installs, real offline, real notifications, Pencil versus finger.
Test on **iPhone (iP)**, **iPad (iPad)** and **desktop Chrome (DC)**. Tick each device column as you go.
Claude Code adds new lines at the end of each phase. The user ticks them.

Columns: iP · iPad · DC

## Phase 1 — Foundations

- [ ] [ ] [ ] Opens from its web address and shows the Airhead shell
- [ ] [ ] [ ] Installs: iPhone/iPad via Share → Add to Home Screen; Chrome via the install icon in the address bar
- [ ] [ ] [ ] Installed app opens full-screen, with no browser bars and safe areas respected (notch, home bar)
- [ ] [ ] [ ] Airplane mode / network off → installed app still opens and shows the shell
- [ ] [ ] [ ] Correct navigation for the screen size: bottom tabs (phone), sidebar (iPad), three panes (desktop)
- [ ] [ ] [ ] Light and dark mode both look right
- [ ] [ ] [ ] Sign in with Google works; signing out and back in works
- [ ] [ ] [ ] Each device appears in Settings → Devices
- [ ] [ ] [ ] App lock: Face ID / Touch ID unlocks; the lock returns after the chosen time-out
- [ ] CI is green on GitHub; keep-alive and backup workflows ran successfully
- [ ] [ ] [ ] Email sign-in: "Email me a code" → the 6-digit code from the email signs in **inside the installed app** (on iPhone, tapping the link opens Safari instead; that's expected)
- [ ] — — Google sign-in completes inside the installed iPhone app (if it gets stuck in Safari, note it; the email code is the fallback)
- [ ] [ ] [ ] App lock: turning it on asks for Face ID / Touch ID; "Lock after: Immediately" locks every time you leave the app
- [ ] [ ] [ ] App lock recovery: on the lock screen, "Sign out" → sign back in → app opens unlocked
- [ ] [ ] [ ] A deep link (e.g. …/today) opened offline in the installed app still shows the app
- [ ] Cloudflare Pages: a PR shows a preview link; `https://airhead.pages.dev` serves the latest main

## Phase 2 — Capture core and sync

- [ ] [ ] [ ] Capture box is focused on open; typing and saving feel instant
- [ ] [ ] — iOS keyboard dictation works in the capture box
- [ ] [ ] [ ] Paste button appears with a link on the clipboard and saves it as a reading item
- [ ] [ ] [ ] Photo attach works and the image is compressed (check the size in Library)
- [ ] [ ] [ ] "Dentist Tue 3pm" offline → event created instantly with undo
- [ ] [ ] [ ] "Sometime next week" → suggestion card, not an event
- [ ] [ ] [ ] "3/4 meeting" is read as 3 April
- [ ] [ ] [ ] Capture in airplane mode on one device → appears on the other two within a minute of reconnecting
- [ ] [ ] [ ] The sync icon shows "n waiting" offline and "synced" afterwards
- [ ] [ ] [ ] Delete an item → it's in Trash → restore works
- [ ] [ ] [ ] Search finds items by title and body
- [ ] — [ ] Export downloads a zip that opens, with Markdown files and a JSON file
- [ ] [ ] [ ] "Event added: … · Undo" toast appears for a clear date; Undo removes the event and the capture goes back to "Sorting soon"
- [ ] [ ] [ ] Suggestion cards on Today: "Add to calendar" and "Dismiss" both work
- [ ] [ ] [ ] Inbox → Unsorted: "Sort as Task" (etc.) moves a capture out of the Inbox into the Library
- [ ] [ ] [ ] Library: type tabs, Topic filter and dates filter; an item can be edited, re-typed and deleted
- [ ] — [ ] Desktop/iPad keyboard: "/" jumps to Library search (not while typing in a box)
- [ ] [ ] [ ] Paste link: iOS asks to allow pasting only when you tap the button
- [ ] [ ] [ ] A photo shows up in Supabase Storage (bucket `captures`, folder = your user id) once online
- [ ] [ ] [ ] Settings → Sync shows "Last successful sync" and "Sync now" works

## Phase 3 — AI sorting, link reading, lists, memory

- [ ] [ ] [ ] Five or more captures get sorted within the threshold time without tapping anything
- [ ] [ ] [ ] "Sort now" sorts immediately
- [ ] [ ] [ ] A brain dump splits into separate items, including a shopping list entry
- [ ] [ ] [ ] An ambiguous capture shows a one-tap "Task or Idea?" choice
- [ ] [ ] [ ] A news article link gets a summary and key points
- [ ] [ ] [ ] A paywalled link is marked "couldn't read"
- [ ] [ ] [ ] Lists: create, tick off and clear completed
- [ ] [ ] [ ] An everyday fact appears in "What Airhead knows about me"; a fact about a person waits for approval
- [ ] [ ] [ ] After four "buy …" captures, the fifth is sorted instantly offline (learned rule)
- [ ] [ ] [ ] Run check-up shows findings, and the one-tap fixes work
- [ ] [ ] [ ] AI usage screen totals roughly match the Claude Console billing page
- [ ] A low test monthly cap pauses background sorting; captures still save
- [ ] [ ] [ ] Inbox → Needs a tap: "Create list?" makes the list and moves the entries into it
- [ ] [ ] [ ] Insights → AI usage shows month to date, a projection and the daily chart; editing a price changes the figures
- [ ] [ ] [ ] Insights → Success measures show captures a day, correction rate and AI cost a month
- [ ] [ ] [ ] Re-sorting an item the learned rule sorted switches that rule off (Settings → Memory → Rules)
- [ ] [ ] [ ] "Check for contradictions" (online) finds two conflicting facts; "Keep the first" moves the other to Trash
- [ ] [ ] [ ] Insights shows "Last check-up: …" after the monthly automatic run

## Phase 4 — Calendar, sharing, work and leave, import, notifications

Calendar
- [ ] [ ] [ ] Day, week, month and agenda views all work; agenda is the phone default
- [ ] — [ ] Drag an event to a new time; drag a task onto the calendar to time-block it
- [ ] [ ] [ ] Click/tap an empty slot to create an event
- [ ] [ ] [ ] Irish public holidays for this year and next match citizensinformation.ie
- [ ] [ ] [ ] Calendar toggles hide and show Personal, Us, tasks, holidays, leave and each linked calendar
- [ ] [ ] [ ] Select several days → "Book as leave" opens the leave sheet with those dates
- [ ] [ ] [ ] Event editor: set a reminder (e.g. 1 hour before) and "No reminder"

Work and leave
- [ ] [ ] [ ] Work location chip changes with one tap and shows on the calendar
- [ ] [ ] [ ] Booking leave across a public holiday deducts the right number of days
- [ ] [ ] [ ] Leave counter is correct for a December–November leave year
- [ ] [ ] [ ] "AL 14–18 July" in Capture proposes a booking
- [ ] [ ] [ ] Settings → Work: change entitlement, leave year and usual week; the counter updates
- [ ] [ ] [ ] Work screen: carried-over days and the run-out warning look right
- [ ] [ ] [ ] Insights → Where I worked shows days per location by week and month

Sharing
- [ ] Girlfriend subscribes to the Us link and sees Us events and shared leave in her calendar app
- [ ] My own "me" feed shows Airhead events in Apple Calendar on my iPhone
- [ ] Her linked calendar's events appear in Airhead within about 30 minutes
- [ ] "New link" stops the old Us link (it shows nothing after her calendar app refreshes)
- [ ] A bad linked-calendar link shows a clear error in Settings → Linked calendars

Import
- [ ] — [ ] A fixtures PDF with "attending all home games" imports as a reviewed series
- [ ] — [ ] A .ics file and a CSV both import correctly
- [ ] [ ] [ ] Deleting the series removes all its events
- [ ] [ ] — A screenshot of a fixtures list imports (one AI call); unconfirmed times show as "time TBC"
- [ ] [ ] [ ] A fixtures link that is an .ics offers "Add it as a linked calendar instead"

Notifications (iPhone must be installed to the home screen)
- [ ] — — Enable notifications → test notification arrives
- [ ] — — Event reminder arrives about 30 minutes before
- [ ] — — Location checklist arrives the evening before an office day
- [ ] — — Evening review arrives and its screen works (tick off, carry over, drop)
- [ ] — — Nothing arrives during quiet hours (except allowed event reminders)
- [ ] — [ ] iPad and desktop stay silent by default
- [ ] — — A time-TBC imported event sends "Time confirmed yet?" a week before
- [ ] — — More than the daily limit arrives as one summary notification
- [ ] — [ ] Settings → Notifications: switch a device on or off; change quiet hours and the reminder default

## Phase 5 — Today and morning brief

- [ ] — — The morning round-up arrives at the chosen time and opens Today
- [ ] [ ] [ ] Today shows the brief, today's events, Top 3 with suggested slots, and Also today (collapsed)
- [ ] [ ] [ ] "Block" on a Top 3 slot puts the task on the calendar at that time
- [ ] [ ] [ ] Yesterday's unfinished Top 3 shows as carry-over cards; Today / Done / Drop work
- [ ] [ ] [ ] Add a task to today's Top 3 from the Library; a fourth asks which to swap
- [ ] [ ] [ ] Offline before the brief: Today still shows a code-built list
- [ ] [ ] [ ] Settings → Today: Regenerate brief shows its cost and works; brief time can be changed
- [ ] — [ ] Desktop right panel shows Top 3 and next events
- [ ] With a low test AI cap, the morning list still arrives (fallback)

## v0.1 release

- [ ] Everything above is ticked
- [ ] Ready to tag `v0.1.0` → live deploy
