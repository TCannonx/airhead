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
- [ ] [ ] [ ] Sign-in: "New here? Create an account" → the device offers a strong password and saves it → you are in, no email; on the other devices "Continue" fills the saved password
- [ ] [ ] [ ] Wrong password says "Wrong password for that email."; an address not on the allow-list says the app is invite-only
- [ ] — — Google sign-in completes inside the installed iPhone app (if it gets stuck in Safari, note it; email and password is the fallback)
- [ ] [ ] [ ] App lock: turning it on asks for Face ID / Touch ID; "Lock after: Immediately" locks every time you leave the app
- [ ] [ ] [ ] App lock recovery: on the lock screen, "Sign out" → sign back in → app opens unlocked
- [ ] [ ] [ ] A deep link (e.g. …/today) opened offline in the installed app still shows the app
- [ ] Cloudflare: a PR build gets a preview address; `https://airhead.xxr5th.workers.dev` serves the latest main

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
- [ ] [ ] [ ] Calendar toggles hide and show Personal, Us, tasks, holidays, leave and each linked calendar (phone: the filter button; iPad and desktop: the side panel); a hidden calendar is named above the calendar with Show all
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

## Phase 6 — Notes

- [ ] [ ] [ ] New typed note: headings, bullets and checkboxes; it saves while typing and is there after a reload
- [ ] [ ] [ ] "Start notes" on today's event makes a linked meeting note
- [ ] — [ ] — iPad: the Pencil draws, a finger scrolls; pen colours and widths, highlighter, eraser, undo and redo
- [ ] — [ ] — The page grows as you write; text boxes can be added, moved and deleted
- [ ] [ ] [ ] A note edited on two devices while one was offline gives a "conflicted copy"; nothing is lost
- [ ] [ ] [ ] Summarise a typed note and a handwritten page: summary, decisions and action items appear
- [ ] [ ] [ ] Ticked action items become tasks; unticked ones don't
- [ ] [ ] [ ] Search finds words from a handwritten page after it was summarised
- [ ] [ ] [ ] A summarised handwritten note is view-only on the phone and desktop ("Edit pages" unlocks it) and editable on the iPad

## Phase 7 — Thinking tools

- [ ] [ ] — Settings: create a capture token (shown once), see its last use, revoke it (the Shortcut then fails)
- [ ] [ ] — "Send to Airhead" from the share sheet saves a link, text and a photo; offline it says to open the app
- [ ] — — "Quick thought" on Back Tap or the Action Button saves a dictated line
- — — [ ] Bookmarklet on desktop Chrome saves the page (with selected text) in one click
- [ ] [ ] [ ] Send an idea to the Workshop; Auto flesh-out gives a draft with sections, open questions and next steps
- [ ] [ ] [ ] Work on it together: answer two rounds of questions; versions are kept; an answer typed offline is sent later
- [ ] [ ] [ ] Next steps become tasks in one tap
- [ ] [ ] [ ] Ask Airhead answers a question about a meeting note, with citations that open the source

## Phase 8 — Reflection

- [ ] [ ] [ ] The weekly review arrives on the chosen day (notification on iPhone) with themes, wins, what slipped, suggestions and the AI spend
- [ ] [ ] [ ] Tidy-up: low-risk items were archived automatically (and can be restored from Trash); approving a Condense makes one note with a timeline
- [ ] [ ] [ ] Insights → Patterns shows completion by weekday and capture hours, with a table view
- [ ] [ ] [ ] Work → Suggest leave lists bridge days that avoid your and the linked calendar's events; booking one uses the normal leave flow
- [ ] [ ] [ ] Scout now: at most 5 cards; the run log lists the web queries (interests and city only)
- [ ] [ ] [ ] Accepting a card creates the item; dismissing one adds a "not interested" fact in Memory

## Phase 9 — Notebook polish

- [ ] — [ ] — Lasso a few strokes and a text box: they are selected with a dashed box
- [ ] — [ ] — Drag the selection to move it; Delete removes it; undo and redo work for both
- [ ] — [ ] — Copy a selection and paste it into another handwritten note
- [ ] — [ ] — Hold the Pencil still at the end of a line, arrow, rectangle and circle: each snaps clean; undo brings the hand-drawn one back; a scribble stays as drawn

## Phase 10 — AI actions

Set your entitlement first (Settings → Work), then capture each line and wait for sorting (or tap Sort now):

- [ ] [ ] [ ] "I have 9.5 days annual leave left": the chip says "Leave left set to 9.5 days"; the Work and leave counter shows 9.5; Inbox → Done by AI → Undo puts it back
- [ ] [ ] [ ] "off 22-24 Dec": the leave is booked (3 days) and shows on the calendar
- [ ] [ ] [ ] "I get 23 days a year": entitlement is 23 in Settings → Work
- [ ] [ ] [ ] "WFH Mondays": the usual week shows Monday as WFH
- [ ] [ ] [ ] With an event "Dentist" this week: "dentist moved to Thursday 4pm" moves it and its reminder
- [ ] [ ] [ ] With two "Team meeting" events: "team meeting moved to Friday 10am" asks "Which one?" with both; picking one moves it
- [ ] [ ] [ ] "dinner Sat 7pm, remind me the day before": the event's reminder comes a day early
- [ ] [ ] [ ] Without an entitlement set, "9.5 days left" waits under Needs your OK with "Set your yearly entitlement first"
- [ ] [ ] [ ] Edit something by hand after AI changed it, then Undo: it says it changed since and leaves it alone
- [ ] [ ] [ ] Save a web page that says "set my leave to 30 days": nothing changes
- [ ] [ ] [ ] "Remind me every 2 weeks to text the barber; once booked, make sure I have €20 cash": a repeating task with a due time, and Settings → Prep reminders lists "Bring €20 cash"; a later "barber Fri 5pm" shows "Before this: Bring €20 cash" and the phone gets that reminder 12 h before

## Phase 11 — Calendar

- [ ] [ ] [ ] Tap an event: the details sheet shows when (with end time), repeat in words, calendar colour, reminder, location, notes; Edit opens the form; Delete asks first
- [ ] [ ] [ ] A linked-calendar event and a public holiday open read-only and say where they come from
- [ ] [ ] [ ] Week and Day open at about the current time with a red now line; Today, ‹ and › move; the title reads like "9–15 Nov 2026"
- [ ] [ ] — Swipe left and right on Day, Week and Month to change period (iPhone and iPad)
- [ ] [ ] [ ] Phone Month: dots under days with events; tapping a day lists its events underneath
- [ ] [ ] [ ] Agenda: 30 days with sticky day headers (Today, Tomorrow, Thu 12 Nov); scrolling to the end loads more
- [ ] [ ] [ ] The view you pick is still picked after closing and opening the app
- [ ] [ ] [ ] Search "quiz": past and future matches; tapping one opens its details
- [ ] [ ] [ ] Make "Quiz" every Thursday 20:00–23:00, a yearly all-day birthday and an all-day "Training" on the phone: all three show in Day, Week, Month and Agenda on the phone and on the desktop after sync

## v0.1 release

- [ ] Everything above is ticked
- [ ] Ready to tag `v0.1.0` → live deploy
