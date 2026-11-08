# AI actions: notes that change leave, work settings and reminders

Date: 2026-11-08 · Status: proposed (approach 1 agreed with the owner)

## Problem

AI sorting only files a capture as items (task, event, reading, idea, meeting, note, list entry).
A note such as _"I have used annual leave this year. I have 9.5 days left till the end of November"_ changes nothing: the AI can't touch leave bookings, the leave balance, work settings or reminders.
The owner expects the AI layer to turn clear notes into actions in the app.

## Decisions already made

- **Apply mode:** clear actions are applied straight away, each with Undo. Unclear ones become proposals (Apply / Edit / Dismiss).
- **Scope:** leave balance, leave bookings, work settings, reminders and due dates, and moving existing events and tasks to a new date or time.
- **Approach:** the existing sorting call also returns actions. The server checks them in code and applies them in the same transaction as the items. No extra AI call.

## Action types

The sorting result gains `actions` per capture (strict JSON schema, nullable fields as today):

| Action | Fields | Example capture |
| --- | --- | --- |
| `set_leave_remaining` | `days`, `as_of` (date), `leave_type` | "9.5 days left till end of November" |
| `set_leave_used` | `days`, `as_of`, `leave_type` | "I've used 12 days so far" |
| `book_leave` | `start_date`, `end_date`, `start_half`, `end_half`, `leave_type`, `status` (planned/requested/approved/taken) | "off 22–24 Dec", "took last Friday off", "sick yesterday" |
| `update_work_setting` | `setting` (one of: `entitlement`, `leave_year_start`, `working_days`, `location_pattern`, `carry_over_max`), `value` | "I get 23 days a year", "leave year runs Dec to Nov", "WFH Mondays" |
| `set_reminder` | `target` (the item from this capture, by index), `remind_at`, or `offset_minutes` before its start/due | "remind me the day before" |
| `reschedule_item` | `target_id` (from the candidate list), `start_at`/`end_at` (events) or `due_at` (tasks), `all_day` | "dentist moved to Thursday 4pm", "push the car service to next week" |

**Finding the item to move.** The request sends, with the batch, a short candidate list of the user's own open events and tasks: id, type, title, current date. It covers the last 7 to the next 90 days, plus overdue tasks, capped at 60, nearest first. This is the user's own data and is treated as data. The model may only name a `target_id` from that list. Imported linked-calendar events are left out (read-only), and so are items in the same batch.

Due dates and repeats remain item fields (`due_at`, `rrule`), as they already are. The prompt is told to fill them every time the text states one.

Each action also carries `confidence` (0–1) and `quote`: the words of the capture it came from, shown in the UI and kept for audit. The capture is data, never instructions. An action can only come from what the person typed, never from the text of a fetched page or file (link and import captures get no actions).

## "Clear": checked in code, never on trust

The function validates each action against the user's current data before applying it. It is applied straight away (`status = applied`) only if **all** of these hold:

1. `confidence ≥ 0.8` (the same bar as events today).
2. Dates are explicit, valid and inside the current or next leave year. A booking is at most 60 days long.
3. Numbers are sensible: 0 ≤ days ≤ entitlement + carry-over (leave), entitlement 0–100, half-day steps only.
4. Nothing clashes. A booking that overlaps an existing one is not booked twice. A balance or settings change that equals the current value is a no-op (recorded as `skipped`, no chip).
5. For `reschedule_item`: the target is in the candidate list, still open, not deleted, and not part of a repeating series (a series becomes a proposal: "This repeats; change one or all?"). The new date is explicit and not in the past. Only one candidate plausibly matches: the model also returns `other_matches` (ids), and any entry there makes it a proposal that lets the user pick.
6. The data it depends on exists. `set_leave_remaining` needs an entitlement the user has actually set: an `entitlement` key present in `settings.data.work`, not the default 21. Otherwise it becomes a proposal that asks for the entitlement.

Anything failing a check becomes a **proposal** (`status = proposed`) with a plain reason ("Set your yearly entitlement first", "Overlaps leave on 23 Dec").
At most 5 actions per capture; extra ones are dropped and noted.

## Data

**New table `ai_actions`** (synced like other user tables, RLS owner-only, additive migration):

- `id`, `user_id`, `capture_id`, `kind`, `payload` jsonb (the validated action)
- `status`: `applied | proposed | dismissed | undone | skipped`
- `reason` (why it's a proposal), `quote`, `confidence`
- `target_table`, `target_id` (the row it changed or created)
- `before` jsonb, `after` jsonb: the exact previous and new values, for Undo
- usual `created_at`, `updated_at`, `server_updated_at`, `deleted_at`

**Leave balance setting:** `settings.data.work.opening_used`, a map from leave-year start date to days. These are days used before Airhead, counted by the leave engine like taken bookings.
- `set_leave_remaining d` stores `opening_used = entitlement + carry − used_in_app − d` (never below 0).
- `set_leave_used d` stores `d − used_in_app` (never below 0).
- `used_in_app` = deducting days of this leave year's bookings that end on or before `as_of`, whatever their status. Bookings after `as_of` are plans the person hadn't counted, so the counter shows them coming off the stated figure.
- The Work and leave page shows it as an editable "Used before Airhead" box. The client and the Deno leave engines both learn the field: they share code with tests on each side.

**Leave bookings** made by actions are ordinary `leave_bookings` rows (`capture_id` set). `days` is computed on the server with the shared leave engine (`_shared/leave`), the same way the device computes it.

**Moved items** are updated in place (`start_at`, `end_at`, `all_day` or `due_at`). `before` keeps the old values. Pending reminders for the item are re-timed by the same code that times them when an item is edited by hand. The capture that moved it stays a capture and creates no duplicate item.

**Reminders** are ordinary `nudges` rows (`kind = event_reminder` or `task_due`) tied to the capture's item.

## Flow

1. `sort-batch` asks the model as now. Prompt v4 adds the action list, with rules and examples. The output schema gains `actions`.
2. `plan.ts` validates and classifies each action (pure functions, unit-tested), using the user's work settings, bookings, leave year and the candidate items. These are loaded once per batch.
3. `apply_sort_batch` (new version, same transaction) applies `applied` actions to `settings`, `leave_bookings` and `nudges`, writes the `ai_actions` rows with `before` and `after`, and links them to the capture.
4. Devices pull `ai_actions` through normal sync.

## UI

- **Capture chip:** for example "Leave left set to 9.5 days · Undo" or "1 action needs your OK". It takes priority over "Sorted".
- **Inbox:** two short sections above Unsorted:
  - **Done by AI (last 7 days):** each line has its `quote` and **Undo**.
  - **Needs your OK:** each line has its reason, plus **Apply**, **Edit** (opens the normal sheet pre-filled: leave sheet, work settings, reminder) and **Dismiss**.
- **Undo** writes `before` back as a normal local edit (settings key, booking soft-deleted, nudge cancelled) and marks the action `undone`. It works offline and syncs like any edit. If the target has changed since (its `updated_at` is newer than the action's), Undo says so and opens the item instead of overwriting.
- **Apply** on a proposal re-runs the same checks on the device. If they now pass, it applies locally; if not, it opens Edit.

## Errors and safety

- An invalid or unknown action is dropped, and logged in the function's stats. It never fails the batch: the items are still saved.
- Actions never delete or rename anything, except Undo of the action's own change. Moving an item changes only its date and time fields.
- No live configuration changes; the migration is additive. Tests use AI fixtures only (`tests/fixtures/ai/sort-batch-actions.json`) and never call the paid API.
- Cost: the same call, with slightly longer output. Recorded in `ai_usage` as today.

## Testing

- **Deno:** schema parsing; each validation rule (pass, and each failure → proposal with its reason); the `opening_used` arithmetic; leave days via the shared engine; the planner with the fixture batch (the owner's 9.5-day sentence, "off 22–24 Dec", "I get 23 days", "remind me the day before", "dentist moved to Thursday 4pm" (one match: applied), "meeting moved to Friday" with two meetings (proposal with a choice), a repeating item (proposal), plus a link capture that must yield no actions).
- **pgTAP:** `apply_sort_batch` applies actions atomically, writes before and after, and RLS keeps `ai_actions` owner-only.
- **Vitest:** the leave engine with `opening_used`; chip text; Inbox sections; Undo (including a target changed since); Apply re-checks.
- **Playwright (sync suite):** a capture is sorted with the fixture, the chip shows the action, and Undo restores the balance.

## Out of scope

- Actions from link pages, imported files or screenshots (data, never instructions).
- Changing anything about existing items other than their date and time (titles, cancelling, deleting), and settings outside the five listed.
- Asking follow-up questions in a chat. A proposal's reason plus Edit covers this.

## Rollout

Ship to dev behind the existing sorting path. The owner tests with real notes, the correction rate in Insights shows whether the thresholds need tuning, and then it goes live with the next tag.
