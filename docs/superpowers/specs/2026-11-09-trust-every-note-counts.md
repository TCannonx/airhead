# Phase 12 — Trust: every note counts

Date: 2026-11-09. Status: approved by the owner (choices below).

## Why

The owner: "the big thing with this app is trust. This should be built into the foundation." People must be able to trust that the context in their notes is handled as valuably as possible. The app should pick up every piece of information in a note and create tasks, seek clarification or add value wherever needed.

Example that fails today: "Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder". Airhead makes a weekly Friday event and quietly files "Still need to plan" in the Workshop. The note clearly says more planning is needed. Airhead should take that planning forward and nudge the person with how to proceed.

## Principles (apply to every future feature)

1. **Nothing is silent.** Every part of every note ends up as something the person can see: an item, an action, a question or "kept as written". Airhead never drops a part without saying so.
2. **Show your work.** Each capture has a receipt saying what Airhead did with each part, in plain words, linked to the result.
3. **Move it forward.** When a note implies more work ("still need to plan", "sort out", "figure out", "placeholder", "need to decide"), Airhead creates a next step and asks what it needs to know.
4. **Ask little, ask well.** At most 3 questions per note, only when the note implies more work or a detail needed to act is missing. A clear note gets no questions. Each question offers quick answers where it can.
5. **The person stays in charge.** Questions never block. Dismissing one is fine and counts as a correction. Answers are the person's own words and are handled like a capture.
6. **Same cost.** Questions, receipts and planning steps come from the same 5-minute sorting batch. Answers ride the next batch. No extra AI calls.

## Owner's choices

- Questions appear in **Inbox ("Questions for you", with quick-answer chips) and on the related item/event**, plus a Today card while one is open. **No push** for questions.
- Ask **when a note implies more work** (or a detail needed to act is missing), at most 3 per note.

## What gets built

### 12.1 Follow-ups from sorting

- The sorting output gains, per result, `follow_ups`: up to 3 `{ question, options (0–4 short quick answers), about_item (index or title of the item it relates to, or null) }`.
- It also gains a **planning step**: when a note implies more work, a task such as "Plan Christmas sandwiches" is due before the first occurrence of the related event (or in 3 days if there is none), with up to 5 checklist steps.
- The prompt says when to ask, and when not to: clear notes get no questions. Questions must be specific to the note ("Who are the sandwiches for?", "How many people?", "Making them or ordering?"), never generic ("Anything else?").
- A new table `follow_ups` (additive migration, RLS owner-only, synced): id, user_id, capture_id, item_id, question, options jsonb, status (open/answered/dismissed), answer, created_at, updated_at, deleted_at. It is written by `apply_sort_batch` (new version) with the rest of the batch.
- The output must still pass `_shared/schemas/limits.test.ts` (union-param limit). Stand-in AI answers and the contract test are updated.

### 12.2 Answering

- Inbox gets "Questions for you": the question, the note it came from, quick-answer chips, a text box and Dismiss.
- The related item shows its open questions under its details. Today shows a card "Airhead has N questions" while any are open.
- An answer marks the follow-up answered and creates a capture linked to it (`payload.follow_up_id`, the question and the item id). The next batch sees the question, the answer and the item as context. It can then update the item (existing actions, with Undo), add tasks or checklist steps, or ask one more question (at most one more round per thread).
- Dismiss records a correction ("not useful").

### 12.3 Receipts

- Each capture (Capture → Recent captures, Inbox, and the item page's "From your note") gets "What Airhead did". This is one line per outcome, each with the quoted words it came from:
  - item created (linked);
  - action applied (with Undo) or proposed;
  - question asked;
  - sent to the Workshop;
  - "Kept as written, not acted on: …".
- It is built on the device from items, ai_actions and follow_ups with that capture_id, plus `leftover`. The model returns a `quote` for items as well (actions already have one).
- Before sorting has run, it says "Waiting for AI sorting (next check by HH:MM)".

### 12.4 Proving it: completeness checks

- `ai-eval` cases gain completeness checks:
  - **Christmas:** weekly Friday event + planning task due before the first Friday + at least one specific question + nothing dropped.
  - **Haircut:** repeating task + prep rule, no needless question.
  - **Clear notes** (birthday, quiz, shopping): **no** questions, to protect against nagging.
- New owner-style cases with implied work, e.g. "Need to sort out car insurance before it renews end of month", "Thinking about a team night out in December, need to figure out where".
- e2e-sync: a capture with implied work makes a question on A; answering it on B produces the new task on A; Dismiss records a correction.
- Unit and component tests for the receipt builder, the questions section and the answer flow.

### 12.5 Trust in Insights

- Insights → AI shows "Notes handled": captures fully accounted for, questions open, answered and dismissed, and the correction rate. Anything dropped shows as a number the person can open.

## Out of scope

- Push for questions (the owner chose no push).
- Multi-round chat about a note (the Workshop covers that).
