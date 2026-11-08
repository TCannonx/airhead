# Phase 11: calendar overhaul, nothing lost, Workshop routing

Date: 2026-11-08. Status: agreed with the owner (choices below).

## Why

- On dev, notes lost their meaning. "Training on Tuesday. Need a reminder to send report to Trevor" became one event titled "Training . Need a reminder to send report to Trevor". The task to send the report was lost. The instant date rule made the event and marked the note sorted, so the AI never saw it. "Quiz every Thursday 8pm-12pm" lost its end time.
- Events showed in the calendar and then went missing (under investigation with the owner; the server data is intact).
- The calendar is hard to use next to Google, Apple and Fantastical. Tapping an event opens the edit form. There is no "now" line and no Today button. Repeating events cannot be edited one at a time. There is no search.

## Owner's choices

- Calendar: easier viewing, faster adding, repeating events done right, find and filter (all four).
- Workshop: a Send to Workshop button on every capture, note and item, **and** AI routing of anything it cannot fully use.
- Long notes: keep the instant event, **and** send the note to AI sorting, which tidies the event and adds what was missed.

## 11.1 Nothing lost: instant events are tidied by AI

- **Simple note:** one sentence of at most 8 words, with no instruction words ("need", "remind", "and then", …). It becomes an instant event and is marked sorted, as now.
- **Longer note:** the instant event is still made at once, but the capture stays `unsorted` with `payload.instant_item_id`. The next sorting batch sees `<capture … instant_event="<title> | <start>">` and is told the event already exists. Its first event item is that event, with a clean title, the stated end time and any repeat. Everything else becomes other items as usual.
- **Planner:** for such a capture, the first event item becomes an **update** of the instant item (title, end_at, rrule, all_day) instead of a new item. `apply_sort_batch` v4 applies item updates only if the item's `updated_at` is unchanged, the same freshness rule as actions. Logged as an `ai_actions` row of kind `tidy_item` (applied, with Undo).
- **Rules:** time ranges ("8pm-12pm", "8-11pm") set `end_at` in the instant rule too.

## 11.2 Workshop routing

- A Send to Workshop button on every capture (Capture's recent list, Inbox), every item (already on the item page) and every note (note editor menu). It sets `data.workshop = true` on the item, or creates a note item from a capture that has none.
- AI routing: the prompt asks for `suggest_workshop` on any item that is a rough plan, an open question or a "still need to plan" placeholder. The planner also sends to the Workshop:
  - a capture whose text the batch could not map at all (no items, no actions, not a link);
  - a capture whose items cover only part of its text: the model sets the new result field `leftover` to the unmapped words. These become a Workshop note titled with the leftover, linked to the capture.
  
  `leftover` is a string, so it adds no union parameter.
- Chip: "Sent to Workshop".

## 11.3 Calendar: easier viewing

- Tapping an event opens a **details sheet** with title, when, repeat in words, calendar, reminder, prep reminders, location and notes, plus buttons Edit, Delete and Open notes. Editing is one tap further.
- **Month view** (phone default stays Agenda): days with dots, and the selected day's list underneath.
- Week and day views: a red **now** line, opening scrolled to the current time. **Today** button. Swipe left and right between periods. The title shows the period ("9–15 Nov 2026").

## 11.4 Calendar: faster adding

- A **quick add** box at the top of the calendar uses the same rules as Capture (including the new time ranges) and shows a preview ("Quiz · every Thu · 20:00–23:00") before saving.
- Tap an empty slot to create an event at that time. Drag across slots for a span; this already works on desktop, so add tap on the phone.
- The add form gets repeat, until, reminder and calendar.

## 11.5 Calendar: repeating events done right

- Edit or delete a repeating event as **this one**, **this and following**, or **all**:
  - "this one": an exception (`data.exdates` plus a one-off item linked by `data.parent_id`);
  - "this and following": the old rule gets `UNTIL`, plus a new item from the chosen occurrence.
- Moving one occurrence by drag asks the same question.
- Repeat wording: "Every Thursday until 31 Dec".

## 11.6 Calendar: find and filter

- Search events by title, past and future (local, instant).
- **Agenda** shows the next 30 days, grouped by day, and loads more on scroll.
- The calendar toggles (Personal, Us, Tasks, Holidays, Leave, linked calendars) sit in one visible panel with their colours and are remembered per device.

## Missing events

Separate from the build. Find out with the owner which view and which events. Add an e2e test that events made on one device stay visible in Week, Month and Agenda after a sync on that device and the other.

## Testing (release gate)

Each step ships with unit tests and an e2e test of the visible behaviour:
- 11.1: the Training and Quiz notes with the stand-in AI;
- 11.2: the button, plus AI routing of a leftover;
- 11.3–11.6: the details sheet, the now line, quick add, "this one" versus "all", search and the toggles.
