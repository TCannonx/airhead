# Decisions

Decisions and library versions, newest first.

## 2026-11-07 — Sign-in: email and password, invite-only (replaces email codes)
- **Why:** on the real dev site the email route failed repeatedly: Supabase's built-in sender allows a few emails an hour, its templates can't be edited without a custom sender (so no code in the email), and the link only signs in the browser that asked for it. The user asked for seamless sign-up for "me and a few people".
- **How:** one form, email + password. `continueWithPassword` tries `signInWithPassword`; on `invalid_credentials` it tries `signUp`, and `user_already_exists` then means "wrong password". Hosted projects need **Confirm email** off so sign-up returns a session at once. Password managers do the rest (`autocomplete` `username` / `current-password`, and `new-password` in "Create an account" so iOS and Chrome offer a strong one).
- **Invite-only:** migration 0029 adds `signup_allowlist` (addresses or `@domain`) and the **Before User Created** Postgres hook `hook_before_user_created` (free plan; not security definer, runs as `supabase_auth_admin`, per the Supabase auth-hooks docs). Refusals return 403 with a message starting `invite_only:`, which the app turns into plain words. The hook is switched on locally in `config.toml` and by hand in hosted projects (BLOCKERS item 3); `supabase/seed.sql` allows `@example.test` for local and CI only. The owner's address is added in the dashboard, never in a migration (the repo is public).
- **Google** stays optional: the app reads `/auth/v1/settings` and shows the button only when the provider is on. New Google users pass the same hook.
- Email codes, the link-error handling and the mail-reading e2e helper are removed. Supersedes the "Email fallback is a 6-digit code" decision below.

## 2026-11-07 — Dev site is a Cloudflare Worker
- Cloudflare's **Workers & Pages → Create** now makes a Worker with static assets, so the dev site is the Worker `airhead` at **https://airhead.xxr5th.workers.dev** (the `airhead-dev.pages.dev` name below was never used). Its Git integration builds every push to `main` plus preview builds.
- Workers static assets honour the same `_headers` file and serve `index.html` for unknown paths, so no repo change was needed; checked on the live dev site.
- **`wrangler.jsonc`** (Worker `airhead`, assets from `./dist`, `not_found_handling: single-page-application`) makes the setup explicit: PR builds run `wrangler preview` (open beta), which fails unless the config has a `previews` block (empty is fine); `main` deploys worked on Cloudflare's auto-detected setup. `wrangler deploy --dry-run` reads it cleanly (wrangler 4.158.0).
- Preview (non-main) builds have a **separate** set of build variables from production; both must be kept in step.
- `VITE_*` values must be **build** variables (Settings → Build), not runtime variables. A misspelt name (`VITE_SUPABSE_URL`) gave a build in local-only mode; checking the bundle for the project ref catches it.
- `release.yml` still deploys live with `wrangler pages deploy` to a Pages project `airhead-live`. That path still works (Pages projects can be created from the API/CLI); revisit only if the user prefers a Worker for live too.

## 2026-11-07 — Cloudflare Pages address
- **`airhead.pages.dev` is not ours.** It belongs to another Cloudflare account (it serves an nginx welcome page). Cloudflare Pages was never connected (BLOCKERS item 5), so no dev site has been deployed yet.
- The dev Pages project is to be named **`airhead-dev`** (`https://airhead-dev.pages.dev`, free when checked), matching the Supabase dev project. Live stays `airhead-live` (also free).
- The docs now use that address. Earlier I reported the dev site as online because the address answered 200; the page itself wasn't checked. Checks of a deployed site now look at the content.

## 2026-11-07 — Task 9.4 Hold-to-snap shapes
- **Recogniser** (`src/lib/ink/shapes.ts`), pure geometry in page units:
  - **line**: endpoints at least 40 apart, every point within 6% of the length (min 6) of the chord, and a path no longer than 115% of the chord.
  - **closed shapes**: the end returns within 15% of the path length.
    - **ellipse**: normalised radius spread ≤ 0.09 around the bounding ellipse.
    - **rectangle**: ≥ 92% of points within 10% of the bounding box's edges.
  - **arrow**: a straight shaft to the farthest point, then a head of 12–90% of the shaft's length near the tip, behind it and on both sides. Snapped to a clean shaft plus a 30° head.
  - Anything else (scribbles, half circles, short marks) returns null and stays as drawn.
- **Hold**: with the pen tool, no movement over 3 units for 500 ms (`SNAP_HOLD_MS`) while the pen is down snaps the live stroke. The preview shows at once with "Snapped to a line" (also in a polite live region). Moving on after a snap keeps the shape; lifting commits it.
- **Undo**: the stroke is committed as the hand-drawn `add` plus a `replace` with the clean points (a new undo operation). So the first Undo brings back the hand-drawn stroke and the second removes it.
- **Stored as ordinary points**, so sync, rendering and summaries need nothing new.

## 2026-11-07 — Task 9.3 Copy and paste
- **In-app ink clipboard** (`src/lib/ink/clipboard.ts`): "Copy selection" stores a snapshot of the selected strokes and text boxes for this session.
  - It never touches the system clipboard, so pages never need clipboard permission and nothing leaks out.
  - It survives moving between notes inside the app, not a reload.
- **Paste** (shown while the clipboard has something) adds the strokes as one undo step (a new `paste` operation) and the text boxes with new ids.
  - Everything is shifted 30 units right and down from where it was copied, so a paste into the same page doesn't cover the original.
  - The page grows if needed, and the paste is left selected in Lasso mode, ready to move.

## 2026-11-07 — Task 9.2 Move and delete
- **Drag inside the selection box** (Lasso tool) to move it.
  - The selected strokes and the box follow the pointer live, kept inside the page width and below the top.
  - On release the strokes shift as one undo step (a new `move` operation on the undo stack, undone by shifting back). Text boxes move with them.
  - The page grows if the selection lands near the bottom.
- **"Delete selection"** appears while something is selected. It removes the selected strokes as one undo step (the existing `erase` operation) and the selected text boxes.
- **Text boxes stay outside undo**, as since 6.6: they move and delete with the selection but undo doesn't bring them back.

## 2026-11-07 — Task 9.1 Lasso selection
- **Lasso tool** on the handwritten page's toolbar. A free loop (Pencil or mouse; fingers still scroll) selects strokes with at least half their points inside, by even-odd point-in-polygon, and text boxes whose top-left corner is inside. Empty text boxes are ignored.
- The loop shows as a dashed line while drawing; the selection shows as a dashed, lightly filled box around the strokes (including their width) and text boxes. Choosing another tool, a pen colour or a new loop clears it.
- **Pure helpers** in `src/lib/ink/selection.ts`: point in polygon, `selectByLasso`, `selectionBox`, `translateStroke` and `clampMove`, the last two ready for 9.2.
- Tested with unit tests and a Playwright test; pointer drawing is only realistic in a browser.
- Local e2e note: Playwright reuses a server already on port 4173 (`reuseExistingServer` outside CI). A stale `vite preview` left running locally serves an old build, so CI (fresh server) is the check.

## 2026-11-07 — Phase 9 plan
- **Planned before building**, as for Phases 5–8 (by the user's instruction).
- **Snapped shapes stay ordinary strokes** (point lists drawn with perfect-freehand), so stored data, sync and rendering need nothing new. Undo restores the hand-drawn version.
- **The lasso clipboard lives in the app**, not the system clipboard: strokes are app data, and the page should never read the system clipboard without a paste gesture.

## 2026-11-07 — Task 8.12 Suggestion cards
- **Ideas on Today and Insights** (`ScoutCards`): the open cards (up to 5), each with Accept and Dismiss, a Source link for web ideas, and "Scout now" (online, one AI call at most, ≈ €0.04).
- **Accept creates the proposal, and only then**:
  - a task, with a due date at local midnight when one is given, and the source link in the body;
  - or an all-day event (free weekend days).
  - Both carry `data.from_suggestion`. The card becomes `accepted`.
- **Memory**: only web ideas teach it. Accepting adds "Interested in: …" and dismissing adds "Not interested in: …", both as `everyday` facts (no approval needed, editable in Memory).
  - Cards from the person's own data (follow-ups, prep, routines, stalled ideas, free time) add no facts, because "not interested in following up the budget meeting" would only add noise.

## 2026-11-07 — Task 8.11 Scout function
- **Verified** in Claude's API reference: `web_search_20260209` (dynamic filtering on Sonnet 5.5) accepts `max_uses` and `user_location` (`{ type: 'approximate', city, timezone, … }`). Searches cost $10 per 1,000, reported in `usage.server_tool_use.web_search_requests`.
- **Split for privacy**:
  - Own-data findings (8.10) become cards straight from code and are never sent to the model.
  - The one AI call (large tier, task `scout`) sees only the code-built web queries, which come from interests and the city. It has `max_uses` equal to the number of queries (at most 3).
  - The model chooses its own search strings, so the run log stores the queries it actually ran (from its `server_tool_use` blocks), falling back to the planned ones.
- **Queries** (`scout/queries.ts`):
  - Only facts in the `everyday` category whose text says likes, loves, enjoys, supports, plays, follows, goes to or interested in.
  - Topics with health words, digits, emails, links or address words are dropped. Capitalised words from facts about people are blocked from any query.
  - No city, or 0 searches allowed in Settings: no AI call at all.
- **Web output** is parsed strictly from a JSON array: https links only, at most 2 ideas, trimmed. Anything else gives no web cards. The structured-output gateway isn't used here because the server tool runs in the same call; usage, cost (tokens plus searches) and the monthly cap are recorded and checked as in `callAI`.
- **Cards**: at most 5, at most 2 from the web, own-data first. Titles already open as cards are skipped. Accepting is 8.12; nothing is created here.
- **When**: weekly right after the weekly review (unless Scout is off), with one "Airhead has N ideas for you" notification. "Scout now" (signed in, `{ mode: 'run' }`) comes with the cards UI in 8.12.

## 2026-11-07 — Task 8.10 Scout findings from own data
- **`findFindings`** (`supabase/functions/scout/findings.ts`) is pure code over the person's items, the linked calendar and their time zone. No AI.
  - **follow_up**: meetings 1–14 days old with no summary and nothing made from them. Proposes "Write up actions from …".
  - **prep**: birthdays and anniversaries in the next 10 days, plus events marked `data.prep`. Proposes a task due the day before.
  - **routine**: recurring tasks over a day past due.
  - **stalled_idea**: ideas untouched for 30 days with no follow-up. Proposes a first-step task.
  - **free_time**: weekend days in the next two weeks with nothing on either calendar, at most two, and only when a linked calendar exists ("free for you both"). Proposes an all-day event.
- Ordinary events (a dentist visit) don't make prep cards. Only birthdays, anniversaries and events the person marks for prep do, to keep cards few.

## 2026-11-07 — Task 8.9 Scout data
- **`scout_runs`** (migration 0028) is the run log. It is written by the server and synced read-only, so the exact web queries can be shown: trigger, queries, searches, cards, cost and status.
- **`suggestions`** are the cards: kind, title, body, source URL, `proposed` (what accepting would create) and status (open, accepted or dismissed). They sync both ways with own-rows RLS, because devices accept and dismiss them.
- **`scout` becomes a nudge kind**, for the weekly "Airhead has N ideas for you".
- **Settings → Scout** (`settings.data.scout`):
  - on or off;
  - the city, the only place detail web searches may use;
  - searches per run, 0–3, default 3; 0 means own data only;
  - the last run's queries are listed.
  - `save` re-reads the latest settings before writing, so two quick changes don't undo each other.
- Dexie v9 adds `scout_runs` (pull-only) and `suggestions`.

## 2026-11-07 — Task 8.8 Holiday suggestions
- **Candidates are found on the device** (`src/lib/leave/suggest.ts`) from data it already holds:
  - holidays, closure days and the work pattern;
  - bookings, which are blocked;
  - Airhead events and the linked calendar, which count as clashes;
  - the remaining balance.
  - So "Suggest leave" on Work shows the next six months' bridges instantly, offline and free.
- **"Ask Airhead to pick"** (`suggest-leave`) makes one small-tier call with prompt `leave.v1`.
  - It sends the candidates the device found, plus upcoming occasions (event titles that look like birthdays, trips, matches and so on), days since the last break of 3+ days, and weeks with 5+ events.
  - It returns two or three picks, each with a one-line reason. Picks outside the candidates sent are dropped.
  - About €0.001.
- **Booking** opens the normal leave sheet prefilled from the first to the last leave day. Days off in between aren't counted as leave, so the usual rules apply.
- **In the weekly review**: when a one-day bridge falls in the next 8 weeks, the review shows a hint with a link to Work (code only).
- **Monthly runs are folded into this**: candidates are recomputed whenever Work or the weekly review opens, so a separate monthly job would add nothing.

## 2026-11-07 — Task 8.7 Bridge-day finder
- **`findBridges`** (`src/lib/leave/bridges.ts`) is pure and import-free, and copied verbatim to `supabase/functions/_shared/leave/bridges.ts`. A Deno test checks the two copies match, so the Deno test command (CI and CLAUDE.md) may now read `src/lib/leave` and `_shared/leave`.
- **Rule**:
  - Leave on 1 working day, or on 2 working days in a row (skipping days off between them), so that the whole run of days off containing it is at least 4 days.
  - Days off come from weekends (non-working days), public holidays and closure days not taken from leave, plus days already booked.
  - Ranked by days off per leave day, then by date. The same run appears once, with the fewest leave days.
- **Skipped**: leave days that clash with commitments (`busy`: Airhead events and the linked calendar), and anything over the remaining balance.
- Each result names the holidays inside its run, for the wording in 8.8.

## 2026-11-07 — Task 8.6 Patterns
- **Built on the device from the reviews' weekly stats** (`content.stats` is the 8.1 digest), last 8 weeks. There is no AI and no server call, so it works offline and costs nothing.
- **Shown**:
  - the done rate;
  - tasks done by weekday (Monday first);
  - capture hours and completion hours (local);
  - carry-overs and notifications per week;
  - topics that slip, and ideas you keep coming back to.
- **Charts** (dataviz guidance): one general `Bars` component, single series, so one hue (indigo, with its dark-mode step) and the title instead of a legend. Thin bars with 4px rounded tops on the baseline, a 2px gap, labels only at the ends, a hover tooltip, a "Show as table" view for each chart, and an accessible name stating the peak.

## 2026-11-07 — Task 8.5 Memory digests
- **The weekly digest paragraph is the memory**: each review stores its digest (at most 80 words, or a code-built line), and nothing else is kept as "history".
- **The morning brief** adds the last 4 digests, newest first, after its digest as "Recent weeks (from weekly reviews)". Each is capped at 600 characters, so at most about 2,400 characters ride along.
- **The weekly review** already reads the last 4 earlier digests (8.3). Raw history is never sent.

## 2026-11-07 — Task 8.4 Weekly review page
- **Insights → This week** (top of Insights) shows the newest review:
  - themes, wins, what slipped and suggestions;
  - "AI this week: €x over n calls";
  - "Tidied for you" with a link to the Trash;
  - the Tidy-up card and the memory card;
  - "Run the weekly review now" (online, ≈ €0.03).
  - `reviews` sync pull-only, like briefs (Dexie v8).
- **Every proposal waits for a tap**:
  - **Keep** sets `data.keep`, so the item isn't offered again (8.2).
  - **Archive** sets `data.archived`: hidden from Library lists, still searchable. An archived capture goes to the Trash.
  - **Delete** is a soft delete (Trash, 30 days).
  - **Condense** merges a group into one typed note titled "<first> (condensed)", with an `<h2>date — title</h2>` section per original, oldest first, and `data.condensed_from`. The originals are archived with `data.condensed_into`.
- **A proposal's state comes from the item itself** (kept, archived, in the Trash, condensed or gone), so the card reads right on every device without writing to the read-only review.
- **Memory**: Merge sets the first fact's text to the merged text and removes the others; Retire archives the fact.

## 2026-11-07 — Task 8.3 Weekly review function
- **`reviews`** (migration 0027): one per person per week, Monday start. Written by the server and synced read-only like briefs. Holds `content` plus a `digest` paragraph for later briefs and reviews (8.5). `weekly_review` becomes a nudge kind.
- **`weekly-review`** makes one large-tier call with prompt `review.v1` (task `weekly_review`, a background call so it respects the monthly cap):
  - In: the week's digest (8.1), the last 4 digests, `ask` Tidy-up candidates (titles, types, reasons and ages only; at most 60) and up to 40 facts, least recently used first.
  - Out: up to 4 themes, 5 wins, 5 slipped and 3 suggestions; a Keep / Archive / Condense / Delete proposal per candidate; fact merges and retirements; a digest of at most 80 words.
- **Validation**: proposals are kept only for `ask` candidates the model was given, and fact changes only for given fact ids. A merge needs two or more facts and the merged text; a retire needs exactly one.
  - Condense needs notes, ideas or meetings in a group of two or more; otherwise it becomes Keep.
  - An injected or made-up id is simply dropped.
- **`auto` candidates go to the Trash at once**, as soft deletes recoverable for 30 days, even when the AI fails (no AI needed). They are listed in the review as "tidied for you".
- **On failure** a numbers-only review is stored (`fallback`) with a code-built digest line.
- **When**: the scheduler runs it on the chosen day and time (notification settings `review_day`, 0 = Monday … 6 = Sunday, default Sunday; `review_time`, default 19:00), once per day through `claim_job`, then sends "Your weekly review is ready".
  - A Sunday run covers the week ending that day; any other day covers the week before.
  - A signed-in "Run now" (`{ mode: 'run' }`) is there for Insights (8.4).

## 2026-11-07 — Task 8.2 Tidy-up candidates
- **`tidy_candidates(user)`** (migration 0026) is service-role only and finds everything in SQL. Each row gives its reason and a mode:
  - `auto` (low risk, from DESIGN): tasks done over 90 days ago, reading items read over 90 days ago, past events over 30 days old with no notes or linked meeting note, and exact duplicates (same type and title, ignoring case and spaces; the oldest copy is kept and the rest point at it);
  - `ask`: near-duplicates (first chunks at gte-small similarity ≥ 0.95, checked over the 300 most recently updated items through the HNSW index) and Unsorted captures over 30 days old.
- **Meeting notes, notes and ideas are always `ask`**, even as exact duplicates.
- **Left alone**: deleted and archived items (`data.archived`), and items the person chose to keep (`data.keep`, set when they keep a proposal in 8.4).
- At most 200 rows; an item found for two reasons appears once (duplicate first).

## 2026-11-07 — Task 8.1 Weekly digest
- **`weekly_digest(user, week_start)`** (migration 0025) works in the person's time zone, Monday to Sunday. It is service-role only and returns titles only, with capped lists:
  - tasks due, done, done on time (within a day of the due date), added and carried;
  - slipped tasks (most carried first) and topics that slip;
  - captures, plus capture and completion hours (24 counts) and completions by weekday (Monday first);
  - ideas that captures kept returning to (`data.related_idea_id`, set by sorting) and ideas added;
  - notifications sent or bundled;
  - AI spend and calls, by task.
- It feeds the weekly review (8.3) and Patterns (8.6). Nothing here needs AI.

## 2026-11-07 — Phase 8 plan
- **Planned before building**, as for Phases 5–7 (by the user's instruction).
- **Web search price (verify item)**: Anthropic's web search costs $10 per 1,000 searches, plus normal token costs, according to Claude's current API reference. Scout caps itself at 3 searches a run, at most about €0.03 a week for search. Task 8.11 checks the tool version and options again before building.
- **Tidy-up candidates are found in code** (SQL). The model only judges the uncertain `ask` ones. Low-risk `auto` cases are removed without a call and can be recovered for 30 days.
- **Bridge-day finder is shared code** like the free-slot finder, so the Work page can show candidates offline. The AI only adds judgement and wording.
- **Scout queries are built in code** from interests and the city, never by the model, so a filter can keep names and personal details out. Every query is logged.

## 2026-11-07 — Task 7.11 Memory by relevance
- **Fact embeddings live in a server-only `fact_embeddings` table** (migration 0024), not on `memory_facts`. That table syncs to devices, and 384 numbers per fact would ride along on every pull.
  - Each row stores the md5 of the text it embedded, so an edited fact is embedded again.
  - `facts_to_embed`, `store_fact_embedding` and `relevant_facts` are service-role only.
- **`embed-items` also embeds waiting facts** (50 per run). The 5-minute dispatch now runs when items or facts are waiting.
- **Choosing facts**:
  - The core profile comes first (about 400 words, most recently used).
  - Then come up to 8 facts most like the text at hand: the captures being sorted, or the idea with its body and capture text.
  - These are picked by gte-small similarity at 0.8 or above (normalised vectors, so similarity = −inner product), and facts already in the profile are skipped.
  - When facts aren't embedded yet or the model fails, facts sharing the most keywords are used instead (words of 4+ letters, minus common words).
  - Chosen facts are marked as used.
- **0.8 is a starting threshold** for gte-small, which scores related English text around 0.8 and up. It is a constant in `_shared/relevant.ts`, to tune once real usage shows how it does.
- A shared `_shared/embed.ts` (`gteSmall`) serves sorting and the Workshop. `embed-items` and `ask` keep their own copies for now.

## 2026-11-07 — Task 7.10 Ask Airhead
- **`hybrid_search(query_text, query_embedding, match_count)`** (migration 0023) follows Supabase's hybrid search guide:
  - full-text (`websearch_to_tsquery`, `ts_rank_cd`) and vector (inner product `<#>`) lists, each up to twice the match count;
  - merged by reciprocal rank fusion with k = 50.
  - It runs as security invoker and filters on `auth.uid()` as well as RLS. It is granted to authenticated users only.
- **`ask` function**:
  - embeds the question with gte-small, then calls `hybrid_search` with a client that carries the user's own token, so search never uses the service role;
  - drops passages whose item is gone and numbers the top 8;
  - makes one call with prompt `ask.v1`: the small tier by default, or the large tier when `settings.data.ask_model` is `large`.
  - Passages are data, never instructions.
  - Citations are kept only when they name a passage that was sent, one per item. With no passages, there is no AI call, just "Nothing in Airhead matches that yet."
- **Library → Ask** sits above the search box:
  - online only, with an estimate (≈ €0.002 quick, ≈ €0.01 thorough) and a model choice stored in the synced settings;
  - citations open the source (notes open in the note page through the item redirect);
  - offline, it says search below works offline.

## 2026-11-07 — Task 7.9 Embeddings
- **Verified**: Supabase's Vector columns guide gives `vector(384)` for its built-in `gte-small` model (huggingface.co/Supabase/gte-small). It is called in Edge Functions as `new Supabase.ai.Session('gte-small')` with `run(text, { mean_pool: true, normalize: true })`.
  - Input is cut at 512 tokens, so chunks stay around 300 words: a 40-word overlap, each chunk led by the item's title.
- **`chunks`** (migration 0022) is server-only, readable by its owner, written only by the service role, and not synced.
  - It holds content, hash, a generated English `fts` tsvector (GIN) and `embedding vector(384)` with HNSW `vector_ip_ops`. The vectors are normalised, so inner product ranks like cosine.
- **What is indexed**:
  - the title and body;
  - typed note text (HTML to text) and ink text boxes;
  - a note's summary, decisions, action titles and transcription;
  - a reading item's summary and key points;
  - the newest Workshop draft.
- **Change tracking by triggers**: changes to items (title, body, data, status, deleted_at), note documents and drafts queue the item in `embed_queue`. Other edits (e.g. a Top 3 date) don't. Every existing item is queued once.
- **`embed-items`**, called every 5 minutes by pg_cron + pg_net (only when something is queued, with the Vault secrets from 3.3):
  - takes up to 25 items (`take_embed_queue`, skip-locked) and re-embeds only chunks whose sha-256 changed;
  - removes chunks past the new end, and all chunks of deleted, dropped or missing items.
  - The service role key is checked in the function itself (`verify_jwt = false`).
- Not checked on a real embedding locally: there is no Docker or Edge Runtime here. The embedder is injected in the Deno tests, and the dev deploy runs the real one.

## 2026-11-07 — Task 7.8 Next steps to tasks
- **Same code as action items (6.8)**: `actionsToTasks` and `tasksFromNote` take a link field, `note_id` for notes or `idea_id` for Workshop ideas. The once-per-title check and the free-rules due parsing are shared.
- **Every step starts ticked** (the plan's choice: in the Workshop the person is already deciding), and "Add N tasks" creates the ticked ones. Steps already added show "Task added", even after a new draft version, because they are matched by title.

## 2026-11-07 — Task 7.7 Work on it together
- **`workshop` mode `turn`**: one large-tier call with prompt `workshop-turn.v1`, task `workshop_turn`.
  - Sent: the idea, the current draft and only the last 6 turns, plus the new answer (none on the first turn). The linked page is not sent again.
  - Returned: two or three questions (capped at three) and the full updated draft, saved as a new version with source `session`.
- **Only the server writes session turns.** It appends the answer and the questions and upserts `workshop_sessions` (id = the item), then returns both rows for the device to show at once.
  - Devices never push sessions, so a stale offline copy can't overwrite newer turns. The synced `pending` column stays unused.
- **An answer typed offline waits on that device** (`meta` key `workshop_pending:<item>`, not synced). The panel shows it as "Waiting to send when you're online" and sends it as soon as the `online` event fires.
- A session is left and resumed simply by leaving the page: the turns are stored.

## 2026-11-07 — Task 7.6 Auto flesh-out
- **One `workshop` function** (mode `flesh_out` now, `turn` in 7.7): one large-tier call with prompt `fleshout.v1`, task `workshop_flesh_out`, medium effort. `callAI` already retries once on invalid output.
- **Input**:
  - the item's title and body;
  - its capture's text and any reading summary, as `<notes>`;
  - a read link's article text, as `<page>`, up to 12,000 characters;
  - the newest draft, so a new run improves on it;
  - the memory profile, whose facts are marked as used.
  - Everything inside the tags is data; the prompt says to ignore instructions there.
- **Output**: the draft schema (summary, sections, open questions, next steps), trimmed and capped. It is inserted as a new `drafts` row with the service role, so the database numbers it. The function returns the row and the device puts it in its local table at once; the next pull brings the same row.
- **Workshop page** `/workshop/:id`:
  - shows the newest version, with "Version N" chips for older ones, and links to the original;
  - Auto flesh-out (or Flesh out again) is online only, with an estimate (≈ €0.02).
  - The Inbox "To flesh out" entries open it, and the item page links to it.

## 2026-11-07 — Task 7.5 Workshop data
- **`drafts`**: one row per version (id, item_id, version, content, source), synced both ways with own-rows RLS.
  - The server numbers versions per item (trigger, advisory lock, unique per item), so two devices adding versions offline never collide.
  - The device uses max + 1 as a placeholder until the next pull.
  - A version's number never changes: devices push with upsert, which fires the insert trigger, so the trigger keeps an existing row's number and update ignores a new one.
- **`workshop_sessions`**: one per item (id = the item's id), holding `turns` and an offline `pending` answer. Newest write wins, like other tables. A session belongs to one person on their own devices, so the risk is small.
- **No foreign key to `items`**: tables sync in a fixed order and offline pushes may arrive first, as with `note_docs`.
- **"In the Workshop" stays `items.data.workshop = true`**: sorting already sets it, and the Inbox already listed it. The item page gains "Send to the Workshop" / "Take out of the Workshop", and the Inbox entries now open the item.
- Draft content is `{ summary, sections [{heading, body}], open_questions, next_steps }`; each part defaults to empty.
## 2026-11-07 — CI minutes
- **The 2,000 free Actions minutes ran out** after about 70 merged PRs. Each merged PR cost about 27 billed minutes:
  - CI on the PR, about 13 (seven jobs, each rounded up to a whole minute);
  - the same CI again on `main` after the squash merge, about 13;
  - the dev deploy, about 1.
  - The daily keep-alive and the weekly backup add about 35 a month.
- **CI now runs on pull requests only.** A squash merge lands exactly the branch that just passed, and PRs are merged one at a time from an up-to-date main, so the second run checked nothing new. It can still be run by hand (`workflow_dispatch`).
- **Lint, typecheck and the function tests share one `checks` job**, saving two rounded-up minutes per run. The required checks are now `checks`, `unit tests`, `e2e tests`, `e2e sync tests` and `database tests`.
- Expected cost per merged PR: about 12 minutes, roughly 165 PRs a month within the free allowance.
- **Then the repo was made public** (the user's choice, reversible), which makes Actions free. The history was checked for secrets first: none, only the two Supabase project addresses, which the app already exposes.

## 2026-11-07 — Task 7.4 Bookmarklet and share target
- **The bookmarklet only opens Airhead's own `/share?url=&title=&text=`** in a 420×320 window. It holds no token and makes no request from the page it runs on.
  - The signed-in app saves the capture itself, through the same `createCapture` as the Capture tab: free rules, offline, synced later.
  - The window closes itself after "Saved to Airhead."
- **The selection is capped at 4,000 characters.** The capture text is the page title plus the quoted selection, or just the title.
- **React 19 blocks `javascript:` links in JSX**, so the Settings link sets its `href` on the element after mount. It is draggable, and a click on it in Airhead itself does nothing.
- **PWA `share_target`** (GET, title/text/url) points at the same `/share`, for Android and desktop Chrome. iOS uses the Shortcuts from 7.3.
- The bookmarklet also works in local mode (no server needed), so Settings shows it there too.

## 2026-11-07 — Task 7.3 iOS Shortcuts
- **Guide in two places**: `docs/SETUP-SHORTCUTS.md` (full, click by click) and a short in-app version under Settings → Capture from anywhere. The in-app version shows this install's real address (from `VITE_SUPABASE_URL`) with Copy.
- **Photos are converted to JPEG and base64-encoded in the Shortcut**, so one JSON request covers every kind of capture.
- **Offline**: "Get Contents of URL" fails without a connection, so the guide says to open Airhead and capture there (it works offline). HTTP errors still return the function's plain-text reason, which the Shortcut shows.
- A test checks that the guide names the address pattern and never contains a real token.

## 2026-11-07 — Task 7.2 ingest-capture
- **`ingest-capture`** takes `Authorization: Bearer <capture token>`, hashes it and calls `use_capture_token` with the service role. Unknown or revoked tokens get 401, over the limit gets 429.
  - `verify_jwt = false`, since the caller has a capture token, not a Supabase session.
  - No CORS: only Shortcuts call it. The bookmarklet goes through the app's own `/share` page (7.4).
- **Saved as sent, Unsorted, `source: 'shortcut'`**, for the existing sorting batch (which also reads links) to handle. The server does not run the free date rules, so dates in a Shortcut capture are read by the AI sort. Nothing in a capture is acted on by this function.
  - A share that is only a link becomes a link capture.
  - Photos (JPEG, PNG, WebP or HEIC, at most 5 MB, base64 in the JSON) go to `captures/<user>/<capture>/<file>` and are listed in `payload.files`, as on the device.
- **Plain-text replies** ("Saved to Airhead." or the reason), which the Shortcut can show as they are.

## 2026-11-07 — Task 7.1 Capture tokens
- **The table already existed** (`capture_tokens` from migration 0001: sha-256 `token_hash`, `label`, `revoked_at`, own-rows RLS). Migration 0020 only adds:
  - `last_used_at`;
  - a `capture_token_uses` log (no user access) for the rate limit;
  - `use_capture_token(hash)`, callable by the service role only. It returns the owner and whether this use is allowed (60 per token per hour) and records the use.
- **Tokens are `ah_` + 32 random bytes in base64url**, made on the device. Only the hash is sent and stored, and the token is shown once with Copy.
- **Not synced to devices**: Settings → Capture from anywhere reads and writes the table directly (own rows). Revoking sets `revoked_at`, after which the lookup no longer finds the token.

## 2026-11-07 — Phase 7 plan
- **Planned before building**, as for Phases 5 and 6 (by the user's instruction).
- **Embeddings, verified** in Supabase's docs (AI models, Generate text embeddings, Hybrid search):
  - The built-in model in Edge Functions is `gte-small`: `new Supabase.ai.Session('gte-small')` and `session.run(text, { mean_pool: true, normalize: true })`. It is English-only and cuts input at 512 tokens, so chunks stay around 300 words.
  - The docs don't state its dimension. 384 is gte-small's published size; Task 7.9 confirms it on a real embedding before the column is fixed.
  - The index is HNSW with `vector_ip_ops` (inner product suits normalised vectors), and hybrid search is the docs' reciprocal rank fusion (k = 50).
- **Bookmarklet without a token**: the bookmarklet opens Airhead's own `/share` page instead of posting from the web page. A capture token inside page context could be read by that page's scripts. Capture tokens are only for iOS Shortcuts.
- **Capture tokens are stored hashed** (sha-256) and shown once.

## 2026-11-07 — Task 6.9 Notes in the Library
- **The Meetings and Notes tabs already existed** (Task 3.x) and list the note items. Opening one (from a tab or from search) goes to `/notes/:id` through the item page's redirect.
- **Reading view**: the summary, decisions, action items and a collapsible transcription sit above the original.
  - Typed notes stay editable everywhere.
  - Summarised handwritten pages are view-only on phone and desktop (`InkView`: a plain SVG plus text, so scrolling and selecting work and nothing can mark the page). On the iPad they stay editable.
  - The iPad is detected with the existing `detectPlatform`: iPadOS reports itself as a Mac with touch points.
  - An "Edit pages" link switches to the editor elsewhere, so a page is never locked.
- **Search** now indexes the note documents as well: typed text (HTML to plain text, one line per block) and ink text boxes, plus the summary and transcription from 6.7.
  - A note re-indexes when either its item or its document changes; the version is both `updated_at` values.

## 2026-11-07 — Task 6.8 Action items to tasks
- **Checklist under the summary**: every proposed action starts unticked, and "Add as task" (or "Add N as tasks") creates only the ticked ones. Nothing is created without that tap.
- **Linked by `data.note_id`** on the task. The owner goes in `data.owner` and in the body ("Owner: Mark"), and the original due text goes in `data.due_text`.
- **Due dates come from the free rules**: `analyseCapture(due_text)` (chrono `en.GB`, forward dates, the device's time zone). Text it can't read ("soon") gives no due date.
- **Already-added check by title**: an action counts as added when the note already has a task with the same normalised title. This holds after "Summarise again" too, because positions can change but titles rarely do. Added actions show "Task added" and can't be ticked again.

## 2026-11-07 — Task 6.7 Summarise
- **One function, `summarise-note`**: one large-tier call (Sonnet with server-side fallback) using prompt `summarise.v1`. It is signed-in only, and the usage row records the task `summarise_note`.
  - Typed notes go as plain text built from the HTML (list items as "- ", checkboxes as "[ ]"/"[x]") inside `<note>`.
  - Handwritten pages go as PNG images (vision), at most 4 pages and 4 MB each.
- **The note is data**: the system prompt says to ignore anything in the note that asks for something. The output is a fixed schema (transcription, summary, decisions, actions with owner and due as written), so nothing in a note can trigger an action. The Deno test sends a note with an injection line in it.
- **Output is cleaned**: text is trimmed and capped, empty decisions and actions are dropped, and the transcription is kept only for handwritten pages.
- **Pages are drawn on the device**: `src/lib/ink/render.ts` puts the strokes (via `Path2D` from the same perfect-freehand outline) and the text boxes on a white canvas. The long side stays at 2000 px or less, and empty pages are skipped.
- **Stored on the note item, not the document**: the result goes in `items.data.summary` with `at`.
  - The device saves it, so it syncs like any item edit and never races edits to the document (`note_docs`).
  - The `note_docs.summary` column stays unused for now.
- **Search** indexes the summary, decisions, action titles and transcription with the item body.
- **Online only**: the button is off when offline and absent in local mode. It shows a fixed estimate (≈ €0.02), the same way the brief does.
- `useOnline` moved to `src/lib/useOnline.ts` so Settings → Today and Summarise share it.

## 2026-11-07 — Task 6.6 Text boxes
- **Text tool**: a new tool on the handwritten page's toolbar. A tap with the Pencil or mouse adds a typed label there and focuses it.
  - The tap's default is prevented so the page doesn't take focus and blur the new box away.
  - Boxes are HTML inputs laid over the SVG, positioned in page units (so they scale with the page) and kept inside it.
  - With the text tool on, a ⠿ handle moves a box and × deletes it.
- **Stored with the strokes**: `pages[0].texts: [{ id, x, y, text }]`, saved with the same debounce. Boxes left empty are dropped (on blur and when saving).
- **Undo and redo cover strokes only**: text boxes are edited directly, like any text field.
- **Helpers**: `src/lib/ink/texts.ts` (add, edit, move, remove, drop empty), with unit tests. The e2e adds a box, reloads and deletes it.

## 2026-11-07 — Task 6.5 Handwritten page
- **Verified: perfect-freehand 1.2.3** (MIT). Each stroke's outline comes from `getStroke`, drawn as a filled SVG path. Pressure is real for the Pencil; for a mouse it is simulated.
- **The page**: one fixed-width page (1000 units wide, starting 1400 tall) in an SVG scaled to the screen.
  - It grows by 600 units whenever writing comes within 250 of the bottom.
  - Stage 1 keeps a single growing page (`pages[0]`); the document shape allows more later.
- **Pencil versus finger**:
  - The page sets `touch-action: none`.
  - Pointer type `pen` (and `mouse` on desktop) draws; `touch` scrolls the main pane by hand, so a resting palm or finger never draws.
- **Tools**: pen in black, blue, red or green, at two widths (3.5 and 7 units); a highlighter (yellow, 18 units, 35% opacity); a stroke eraser that removes whole strokes it touches, by hit-testing against the stroke's segments; undo and redo over add and erase.
- **Storage**: strokes are stored as compact data: `{ tool, color, width, d }`, with `d` holding coordinates in half units and pressure in hundredths, delta-encoded after the first point, with sub-half-unit noise dropped. Never images.
- **Saving**: the document saves 800 ms after the last change and on leaving, and syncs as a whole like typed notes (with conflict copies, 6.2).
- **New handwritten note** joins the New note buttons.
- **Tests**: unit tests for encoding, noise, paths, eraser hits, growth, undo and redo, and reading old or partial documents. A Playwright test draws with the mouse, erases, undoes and reloads.

## 2026-11-07 — Task 6.4 Meeting details
- **What a meeting note holds**: `data.meeting_date` and `data.attendees` (a list of names), edited at the top of the note. Attendees are typed comma-separated and saved when you leave the field.
- **"Start notes"** on an event creates a meeting note with the event's title and date, linked by `data.event_id`. Where it appears:
  - Today's events list.
  - The calendar's event editor.
- **Once notes exist**, the same button reads "Open notes" and opens them.
- **The link key** is the event id, or `id|occurrence` for one meeting of a repeating series, so a weekly meeting gets a note per week.
- **Tests**: the event-editor test now renders inside a router, since the button navigates.

## 2026-11-07 — Task 6.3 Typed notes
- **Verified: TipTap 3.33.0** (MIT): `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, and `@tiptap/extension-list` for the checklist (`TaskList`/`TaskItem`; in v3 the list extensions live together there). `Placeholder` comes from `@tiptap/extensions`.
- **Editor** (`src/features/notes/NoteEditor.tsx`):
  - Headings, bullets, numbered lists, nested checklists, bold and italic, with StarterKit's Markdown-style input rules (`# `, `- `, `1. `, `[ ] `, `**…**`) and a toolbar.
  - It re-renders on each change so the toolbar shows the active formatting.
  - The document is stored as HTML (`note_docs.doc.html`).
- **Saving**: `saveDoc` runs 600 ms after typing pauses, and on leaving the page. The sync engine pushes the whole document about a second later, so "a few seconds after you pause" as designed.
- **The editor keeps its own content while open**: a version arriving from another device during editing doesn't reset the cursor. It shows on reopen, and a clash in between becomes a conflicted copy (6.2).
- **Where notes start and open**:
  - "New note" and "New meeting note" are in the Library and on Capture, and open `/notes/:id`.
  - Library item links for notes redirect there.
  - The note page has an editable title; meeting details come in 6.4.
- **Tests**: jsdom has no layout, so the component test fills in `getClientRects` and `elementFromPoint` for ProseMirror. A Playwright test checks typing with Markdown shortcuts and reload in a real browser.

## 2026-11-07 — Task 6.2 Conflict copies
- **Two places, because sync pushes before it pulls**: a device coming back online sends its edit before it sees the other device's newer one. So the server keeps both too, not only the device.
- **On the server** (migration `20261107000019_note_conflicts.sql`, trigger `a_note_conflict_copy`, which runs before the version bump):
  - **When**: an update to a note document comes from a different device (`writer_device`), is based on an older version (`base_version < version`) and changes the text.
  - **What happens**: the incoming text is saved as a new note, the same type with "… (conflicted copy, 07 Nov 14:05)" in the title (local time), and the server's version stays on the original.
  - **Not conflicts**: the same device editing on, or an edit based on the latest version, applies as normal.
- **On the device** (`applyPage` → `keepBothNoteVersions`): when a pull brings a document that has unsent local edits:
  - If another device wrote it after the edit's base version, the local text becomes a conflicted-copy note (queued to sync), the original takes the server's version, and its stale queued push is dropped.
  - If it is this device's own earlier push coming back, the local edit is kept and just learns the newer version number.
- **Scope**: only note documents. Every other table stays newest-wins, as designed.
- **Tests**: the fake server mirrors both triggers. Sync tests cover the plain hand-over, the device's own echo, an offline edit meeting a newer version (push-first) and a pull-first conflict.

## 2026-11-07 — Task 6.1 Note documents
- **`note_docs`** (migration `20261107000018_note_docs.sql`): one document per note or meeting item, with the same id.
  - `kind` is typed (`{ html }`) or ink (`{ width, pages: [{ height, strokes, texts }] }`, a 1000-wide page starting 1400 tall).
  - Plus `summary` for Summarise (6.7).
  - Own-rows RLS, Realtime, sync index, and the nightly purge.
- **Versions for safe sync**:
  - A trigger numbers every write (`version`: 1 on insert, then +1), ignoring what the device sent.
  - Devices record `base_version` (the server version their edit started from) and `writer_device`.
  - Together these let 6.2 keep both versions when another device changed the note meanwhile, without mistaking a device's own echoed push for a conflict.
- **`createNote` / `saveDoc`** (`src/lib/db/notes.ts`): an item (`data.doc_kind`) plus its document; each save stamps `base_version = version` and this device. Dexie v6.

## 2026-11-07 — Phase 6 plan
- Phase 6 is planned in `PLAN.md` (tasks 6.1–6.9): build stage 1 of Notes from the design, with lasso and shapes left for Phase 9.
- **Documents live in their own synced table** (`note_docs`), keyed by the note item's id. Ink strokes can be large, and keeping them apart from `items` keeps item lists and the brief digest small.
- **Conflict copies are limited to note documents**, as the design asks ("both versions are kept and marked Conflicted copy"); every other table stays newest-wins.
- **Libraries** (MIT): TipTap for typed notes and perfect-freehand for ink. Current versions are checked when each task starts.

## 2026-11-07 — Task 5.9 Brief settings and Regenerate
- **Settings → Today**:
  - **Brief time** (`notifications.brief_time`, default 07:30).
  - **Day window** for Top 3 slots (`today.window_start` and `window_end`, default 08:00–21:00). The day must end after it starts.
  - Both are saved with one button.
  - The window is used by the server's brief (`dayWindow`) and by the device's own list.
- **Brief on or off** is the "Morning brief and round-up" switch in Notifications (5.6). Today says where it is rather than having a second switch for the same thing.
- **Regenerate today's brief (≈ €0.01)**: `POST morning-brief { mode: 'regenerate' }`. It rebuilds and replaces today's brief (with no round-up notification); prep nudges are re-planned.
  - One AI call, counted in AI usage.
  - Disabled offline, and in local mode (no server).
  - The cost line is a fixed estimate from the default Sonnet prices (~3,000 tokens in, ~600 out), shown as an estimate per the design.

## 2026-11-07 — Task 5.6 Scheduling the brief
- **The scheduler tick runs the morning brief** as a once-a-day job (`morning_brief`, claimed through `job_runs`) at `settings.data.notifications.brief_time` (default 07:30, local time).
  - It runs in-process (`runMorningBrief` with the round-up), so there is no extra function call.
  - The round-up nudge it writes goes out in the same tick, under the usual quiet hours and cap.
  - A failing brief is caught, so the rest of the tick still runs. The brief has its own code-built fallback anyway.
- **One switch**: "Morning brief and round-up" (`morning_brief`) is a new notification type, on by default, in both the server and app copies of the settings shape. Turning it off skips the brief altogether, since the round-up is its only delivery.
- **Quiet days**: a day with no tasks and no events is skipped by the brief itself (5.4).

## 2026-11-07 — Tasks 5.7 Today tab and 5.8 Top 3 and carry-over prompts
- **One PR**: both change the same Today screen and Top 3 rows.
- **Today, in order**:
  1. Location chip.
  2. The brief's lines.
  3. Today's events: Airhead, linked calendars, holidays and leave, all-day first.
  4. **Top 3**: each row has a done tick, its reason, and a **"Block 12:30–12:45"** button that turns the suggested slot into a time block on the calendar ("On the calendar at …" once it's there, or "No free slot today").
  5. Collapsed **Also today**.
  6. **From yesterday** cards, leave proposals, other suggestion cards, the leave counter, and the evening review link.
- **With today's brief**: its Top 3 and Also today, using current items. Done items stay ticked; dropped ones disappear. Tasks added by hand after the brief also show.
- **Without one** (before it arrives, offline, or no server): the device ranks open tasks with the shared fallback code (5.5) and finds slots in today's calendar with the shared slot code (5.3) from now on. A line says so.
- **Desktop right panel**: "Today at a glance", a compact Top 3 and today's events.
- **Top 3 by hand**:
  - "Add to today's Top 3" on a task (item page). When three are already picked, a "Swap with" choice appears.
  - ✕ on a Top 3 row removes it.
  - All of it uses `top3_date`, which the brief and the digest already read.
- **From yesterday**: open tasks in yesterday's Top 3 or due yesterday, and not yet in today's.
  - **Today** carries the task over (same as the evening review: `carry_count + 1`, due time moved) and adds it to today's Top 3 if there's room.
  - **Done** and **Drop** close it.
## 2026-11-07 — Task 5.4 Morning brief function
- **Verified: large-tier refusal fallback.** Per the current API docs, Sonnet 5.5 large-tier calls send `fallbacks: "default"` with the beta header `server-side-fallback-2026-07-01`, so on a decline the API re-runs the request on its recommended model within the same call.
  - Haiku 5.5 has no server-side fallback, so small-tier calls don't ask for one.
  - A refusal that still comes back is handled like any other failure.
  - This was the item left over from the Phase 3 gateway decisions.
- **`morning-brief`** (`buildBrief` + `runMorningBrief`): one large-tier call per brief (`morning_brief` in AI usage), with the memory profile as the cached second system block.
  - **Input**: the SQL digest (5.2), enriched in code with holidays, today's location and recurring occurrences.
  - **Prompt `brief.v1`**: a short warm reflection; up to 3 Top 3 ids with a reason and minutes; up to 8 Also-today ids; up to 3 prep nudges with local times. Ids only from the digest; the digest is data, never instructions.
- **Validation in code**:
  - Unknown or repeated ids are dropped.
  - Minutes are clamped to 15–120.
  - Prep times must be later than now; prep ids must be in the digest or null.
  - Text is length-capped.
- **Slots come from code** (5.3): busy = today's timed events from Airhead, recurring occurrences and linked calendars, inside the day window, from now on.
- **Fallback**: any AI failure (cap, refusal, outage, bad output) gives the code-built list (5.5) with slots, stored as `status: 'fallback'` with no reflection and no prep nudges. The day never goes without a list.
- **Writes**:
  - The brief: an upsert per person and day, so Regenerate replaces it.
  - `top3_date` on the chosen tasks. Earlier choices aren't cleared, so tasks picked by hand stay.
  - Prep nudges (`kind = 'prep'`); a regenerated brief cancels the day's earlier pending ones first.
  - For the scheduled run, a round-up nudge: "Good morning · Top 3: A · B · C", opening `/today`. Migration 0017 adds the `morning_brief` nudge kind (a wider check; nothing removed).
- **Quiet days**: a day with no tasks and no events gets no brief.
- **Entry point** `POST morning-brief` (`verify_jwt = false`, checks callers itself): the owner's `{ mode: 'regenerate' }` (no round-up), or the scheduler's service key with `{ user_id }`.
- **New helper**: `localTimeIso` in the scheduler's time helpers, so prep times are correct on clock-change days.

## 2026-11-07 — Tasks 5.3 Free slots and 5.5 Fallback list
- **One PR for both**: they are the two pure helpers the brief (5.4) is built on, with no UI or database of their own.
- **Shared with no imports**: `src/lib/today/slots.ts` and `fallback.ts` have no imports, so the very same text is copied to `supabase/functions/_shared/today/`. A Deno test fails if the copies ever differ. CI's Deno run may now read those two folders.
- **Slots** work in local wall-clock minutes, so a clock-change day needs nothing special:
  - Busy spans get a 5-minute buffer and are merged. Gaps start on a quarter hour and must be at least 15 minutes.
  - Each Top 3 task, in order, goes into the earliest gap of its estimate (clamped to 15–120 minutes). A task that fits nowhere gets no slot.
  - Default day window: 08:00–21:00 on working days, 09:00–21:00 off; settable in 5.9.
- **Fallback order**: today's Top 3, then overdue (oldest due first), then due today (by time), then most carried over, then oldest; ties by title.
  - Top 3 = the first three.
  - Also today = the rest that are due by today or carried over (at most 10), so the list stays short.

## 2026-11-07 — Task 5.2 Morning digest
- **`morning_digest(user_id, local_date)`** (migration `20261107000016_morning_digest.sql`) returns compact JSON in the person's time zone:
  - non-recurring events from today to 7 days ahead (local date and times, calendar, location, time-TBC);
  - recurring events, for the function to expand;
  - linked-calendar occurrences;
  - up to 60 open tasks, ordered overdue or due today first, then today's Top 3, then most carried over, then oldest (with due, carry count and age);
  - yesterday's numbers: tasks done, unfinished Top 3, captures;
  - this week's leave and location overrides;
  - up to 10 active ideas.
- **Titles only, cut to 120 characters, and never notes or bodies**, so the call stays small and private details aren't sent.
- **Holidays, today's location and recurring occurrences are added by the brief function** (5.4) from the shared TypeScript (holiday rules, work settings, rrule). They are computed in code, not stored, so SQL can't produce them; the plan's digest line is met by the pair together.
- **Access**: security definer, not callable by devices. `service_role` is granted execute explicitly, because revoking from PUBLIC also removes it from the service role.

## 2026-11-07 — Task 5.1 Brief table
- **`briefs`** (migration `20261107000015_briefs.sql`): one row per person per local day (`unique (user_id, local_date)`).
  - `status` is `ok` (the AI brief) or `fallback` (the code-built list); also `model` and `cost_eur`.
  - `content` holds the reflection, the Top 3 (item id, title, reason, minutes, suggested local slot), Also today ids and prep nudges.
- **Server-written, read-only on devices**, like `external_events`: owners can only select it. It is synced and published to Realtime, so the Today tab updates when the brief lands.
- **Kept a year**: the nightly purge drops briefs older than 366 days and soft-deleted ones after 30 days.
- **Device**: Zod schema (`content` fields default, so an older or partial brief still reads; `cost_eur` coerced from numeric), Dexie v5, and pull-only sync.

## 2026-11-07 — Phase 5 plan
- Phase 5 is planned in `PLAN.md` (tasks 5.1–5.9), following the user's instruction that phases 5–9 are planned and then built after Phase 4.
- **Kept to the design**:
  - one large-tier call a day, fed a SQL digest;
  - Top 3 slots from gaps computed in code;
  - prep nudges written to `nudges`;
  - a code-built fallback;
  - a round-up notification.
- **Additions, each small and tied to a design line**:
  - Carry-over prompts on Today: "suggestion cards … carry-over decisions".
  - The desktop right panel: "Today on the left of a week view" ("today at a glance").
  - A Regenerate button, with a cost estimate per the AI usage design.
- **Brief ids are validated**: the model may only pick ids from the digest. Anything else is dropped, as with contradictions (3.10).

## 2026-11-07 — Fix: managing imported series
- **The gap**: the design's "edit, recolour or delete the whole series at once" and the Phase 4 checklist's "deleting the series removes all its events" had only the Undo shown straight after an import.
- **Calendar → Import** now lists imported schedules, with event count and calendar.
  - **Recolour**: a series colour, when set, colours its events on the calendar (`CalendarData.series`).
  - **Delete**: two taps ("Delete" then "Delete N events"; no browser dialog) soft-delete the series and all its events. They stay restorable from the Trash for 30 days.

## 2026-11-07 — Task 4.15 Notification settings
- **Where**: Settings → Notifications, below the device controls (4.11). The values live in `settings.data.notifications`.
  - `src/lib/notifications/settings.ts` is a Zod copy of the scheduler's `notif.ts` shape and defaults; keep the two in step.
  - Each bad field falls back alone, per-type switches included.
- **Preferences**:
  - Per-type switches: event reminders, task due, time-TBC checks, evening review, location checklist, leave running out, slipping tasks.
  - Quiet hours (default 22:00–07:30), with "event reminders still come through" (default on).
  - Most notifications a day (default 8, 1–50); extras are bundled into a summary.
  - The default event reminder (at the start, or 5 minutes to 2 hours before; default 30). The reminder trigger in the database reads it (4.12).
  - Times for the evening review (21:00), the checklist (20:00) and morning nudges (08:00).
  - Saved with one button, like Work settings.
- **Per-device toggle**: every device that has turned notifications on is listed with an On/Off switch (`devices.receives_notifications`). More than one device can be on, so desktop Chrome can join the iPhone if wanted (design: "desktop Chrome can be switched on per device"). The first device turned on, or an iPhone, still becomes the receiver automatically (4.11).
- **Not built**: per-notification snooze or done actions. iOS web push doesn't support notification action buttons yet, and the design says "where iOS allows". This stays on the later list.

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

## Service calls accept the new secret keys (2026-11-08)

- Functions that only the database or other functions may call compare the bearer token with `_shared/serviceAuth.ts`: it accepts `SUPABASE_SERVICE_ROLE_KEY` **or** any value of `SUPABASE_SECRET_KEYS` (the `sb_secret_…` keys Supabase injects as JSON), trimmed, never an empty token.
- Why: on dev the legacy `service_role` key shown in the dashboard hashed differently from the injected `SUPABASE_SERVICE_ROLE_KEY`, so the Vault key was refused (401 "Service only") and nothing ran in the background. Vault now holds a `sb_secret_` key (BLOCKERS item 8).
- Follow-up: a token that matches no injected key but is a `sb_secret_` key or a JWT claiming `role: service_role` is shown to Supabase (`GET /auth/v1/admin/users?per_page=1`; only an admin key gets 200) and remembered once accepted. User tokens and junk are refused without that call, so user requests cost nothing extra. This makes the dashboard's legacy `service_role` key work too.

## Free date rules skip years, amounts and past one-off dates (2026-11-08)

- A capture like "I have used annual leave this year. I have 9.5 days left" became an event on 1 January (chrono reads "this year"), or with that fixed, an event "in 9.5 days". The rules now skip parser results that pin only a year, and bare amounts of time ("9.5 days", "2 weeks"; "in 2 weeks" still counts), and return no date for a one-off date already gone. Those captures wait for AI sorting instead of becoming calendar suggestions.

## Used before Airhead (Task 10.1, 2026-11-08)

- `settings.data.work.opening_used` maps a leave-year start (YYYY-MM-DD) to days used before Airhead (0–366, half days allowed). Both leave engines add it to `taken` for that year; carry-over expiry ignores it (it is not tied to dates).
- Editable on the Work and leave page ("Used before Airhead"); AI actions (Phase 10) set it from "N days left" or "N days used".

## ai_actions table (Task 10.2, 2026-11-08)

- Migration 0030. Written by `apply_sort_batch` (service role). The owner can select, insert and update their own rows but not delete them: the sync push is an upsert, so insert is needed alongside update (same pattern as `suggestions`). Inserting one's own row gains nothing; the actions only describe changes already made.
- Kinds: set_leave_remaining, set_leave_used, book_leave, update_work_setting, set_reminder, reschedule_item. Status: applied, proposed, dismissed, undone, skipped. `before`/`after` hold the exact values for Undo and Apply.

## Sorting prompt v4: actions and existing items (Task 10.3, 2026-11-08)

- `SortResult.results[].actions` (strict schema, every field present, nulls when unused). Kinds: set_leave_remaining, set_leave_used, book_leave, update_work_setting (entitlement, leave_year_start, working_days, location_pattern, carry_over_max), set_reminder, reschedule_item.
- The model gets `existing_items`: the person's own open events and tasks from 7 days ago to 90 days ahead plus overdue tasks, nearest first, at most 60 (`pickCandidates`). Titles only (120 characters), no bodies. They are data; reschedule_item may only name one of their ids, and other_matches lists any other plausible ones.
- The v3 file was renamed to v4 (only `run.ts` and its test imported it; history is in git). Until Task 10.4 the actions are ignored.

## AI action planner (Task 10.4, 2026-11-08)

- `sort-batch/actions.ts` decides every action in code: `applied` only at confidence ≥ 0.8 and when every check passes; otherwise `proposed` with a plain reason; `skipped` when it would change nothing. Proposals still carry `after` whenever it can be computed, so Apply is one tap.
- Leave balance: "N left" stores `opening_used = total − leave in Airhead up to as_of − N`; "N used" stores `N − leave in Airhead up to as_of`. Needs an entitlement the person has set (the key present in settings), never the default.
- Bookings: this leave year or the next, at most 60 days, an existing leave type, no overlap, at least one working day; past dates are `taken`.
- Settings: only entitlement, leave_year_start, working_days, location_pattern (merged into the usual week) and carry_over_max, each validated.
- Reminders reuse the existing reminder trigger (refinement 1 of the plan): an event's `data.reminder_minutes` (up to a day), a task's `due_at`. Moving an item therefore moves its reminder.
- Moving items: only a candidate id; ambiguous matches list the choices; repeating items always ask; the new time must be in the future; an event keeps its length. `before` carries `updated_at` for the freshness check.
- Items now get their id in the plan (so a reminder can point at a new item). Captures with only actions are `sorted`; any proposal makes the capture `needs_review`.

## apply_sort_batch v3: actions (Task 10.5, 2026-11-08)

- Migration 0031 replaces `apply_sort_batch`. Items keep the id the planner gave them. Actions for captures still being sorted are written to `ai_actions` in the same transaction.
- Freshness checks: a settings change applies only if every key still has its `before` value; a booking only if no leave overlaps it now; an item move only if the item is open and its `updated_at` still equals `before.updated_at`. Otherwise the row is stored as a proposal ("Changed meanwhile; check before applying").
- Moving an item updates its row, so the existing reminder trigger re-times its nudge. The function now returns `actions` (rows written) too.

## AI actions on devices (Task 10.6, 2026-11-08)

- Undo writes `before` back as an ordinary local edit (works offline, syncs like any change); a booking is soft-deleted. It refuses when the target no longer holds `after` (compared with timestamps normalised, since the server and devices write them differently) and offers a link to check by hand.
- Apply on a proposal does not repeat the server checks (refinement 2 of the plan): it checks only that the target still holds `before` (and, for leave, that nothing overlaps now), then writes `after`. "Which one?" applies the payload times to the item picked (events keep their length). Proposals with nothing to apply show Fix, a link to the right screen, instead of a pre-filled sheet.
- The Inbox shows proposals of any age and applied actions from the last 7 days (at most 10). The capture chip shows the action summary, or "N actions need your OK".
- No Playwright test of AI sorting (refinement 3): the sync e2e stack cannot run the model; the planner, database and screens are covered by Deno, pgTAP and Vitest tests.

## AI actions follow-ups (2026-11-08)

- The sorting context now carries `leave`: the leave type keys and names, the current leave year and whether an entitlement has been set, so leave actions use real keys (the prompt used to say "an existing key" without listing them).
- Undo and Dismiss of an AI action record a `corrections` row (`from_value: {action, summary}`, `to_value: {action: undone|dismissed}`). It counts in the correction rate in Insights, and the next sorting batch sees it among recent corrections. `learn_rules` reads items, not corrections, so learned rules are unaffected.

## Sort now never waits forever (2026-11-08)

- Reported on dev: tapping Sort now did nothing, and the server never received a sorting call (no `sort_batch` AI usage), though the function itself answered correctly. Sort now waited for a full sync with no time limit, and any error was swallowed, so a hung or failing first attempt (it also runs on app open) blocked every later tap silently.
- Now: the sync before sorting is waited on for at most 15 s (the server sorts what it already has), an attempt older than a minute no longer blocks a new tap, the previous message is cleared at the start, and any device-side error shows "Sorting could not start on this device…". The sync after sorting runs in the background.

## Structured-output schema limit (2026-11-08)

- Every sorting call on dev failed with `api_error` after Phase 10: spelling out each action field as a nullable schema property took the sorting schema to 26 union-typed parameters, past the API limit of 16, so the API rejected the request (the weekly review, with its own small schema, kept working).
- Actions now travel as `{kind, quote, confidence, details}` where `details` is a JSON object written as text; `readAction` keeps each field only if it is valid (else null), and the planner checks everything as before. The sorting schema is back to 8 union parameters.
- `_shared/schemas/limits.test.ts` counts union parameters in every AI output schema in use and fails above 16. API rejections now log their status and the API's message (never the request) to the function logs.

## Request time limits (2026-11-08)

- On dev the phone stopped receiving changes (a sorted capture still showed "Sorting soon"; its device row had not changed for hours) while the server was fine. supabase-js has no request timeout, so one stalled request kept the sync run (and Sort now, which waited on it) pending forever.
- The Supabase client now uses `timedFetch`: 30 s for data requests, 150 s for Edge Functions (AI batches), 120 s for storage uploads. A timeout is an ordinary failure, so the sync engine backs off and retries. The caller's own abort still works.
- A failed sync keeps a short `detail` (e.g. "push settings: …"), shown in small text under the sync status in Settings, so the next report names the cause.

## Testing the whole chain before user testing (2026-11-08)

- The owner found in manual testing that AI sorting was rejected by the API and that Sort now and sync did nothing on the phone. Neither could be caught: the e2e sync job ran without Edge Functions (`-x edge-runtime`), and every screen test replaced the server with fakes.
- The e2e sync job now runs `supabase functions serve` with `tests/mock-ai/functions.env`: `ANTHROPIC_BASE_URL` points at `tests/mock-ai/server.mjs`, a stand-in for the Messages API that works out sorting answers from the capture text and **rejects schemas over the API limit** like the real API. All functions build their client through `_shared/anthropic.ts`, which honours that variable (set only in CI).
- New end-to-end tests (`tests/e2e-sync/ai.spec.ts`, `network.spec.ts`): Sort now on a plain note; a leave balance proposal and a booking applied, seen on a second device, then undone; moving an existing event; a stalled push that must not stop sync; Sort now while every data request hangs. `_shared/ai.contract.test.ts` runs the real SDK, prompt and schema against the stand-in in the normal Deno tests.
- Writing them found two real bugs: "dentist moved to Thursday 4pm" and "off 22-24 Dec" were turned into new events by the instant date rule, so the AI never saw them. Captures that change something existing or talk about time off (`FOR_AI` in `captures.ts`) now skip that rule and wait for sorting. The free "AL 14-18 July" leave proposal rule is unchanged.
- `docs/TEST-MATRIX.md` maps every feature to its tests and ranks the remaining gaps; CLAUDE.md section 4b makes it a release gate.

## Repeating tasks (2026-11-08)

- Owner report: "remind me every 2-3 weeks to text the barber" became a task with `FREQ=WEEKLY;INTERVAL=2` but no due time, so no reminder ever fired, and ticking it off would have ended it for good. Repeating tasks were never handled.
- The planner gives a repeating task with no due time its first one: 09:00 tomorrow in the person's time zone. The prompt asks for the stated first time if any, and the shorter interval for ranges ("every 2-3 weeks" → 2).
- `completeTask` moves a repeating task to its next due time after now (missed ones are skipped), clears its Top 3 place and carry count, and records `data.last_done_at`; the existing reminder trigger re-times the nudge. A rule that has ended finishes the task.
- Notes starting "remind me …" now go to AI sorting (`FOR_AI`): the instant date rule would otherwise make a calendar suggestion from "every 2 weeks".
- The task page shows "Due: … · repeats every 2 weeks" (it showed no date for tasks at all).
- Recurrence is computed in UTC, so the reminder's local time can shift by an hour across a clock change; fine for reminders, noted for later.

## Prep rules (2026-11-08)

- Owner note: "I get a haircut every 2-3 weeks. Requires €20 cash. Remind me every 2-3 weeks to text barber for haircut and once booked, ensure I have cash for appointment." The cash part is a standing rule, not a one-off task.
- `settings.data.work.prep_rules`: `{id, match (1-5 words), reminder, minutes_before (0-10080)}`. In both work-settings readers, so saving the Work screen keeps them.
- Migration 0032: `refresh_prep_nudges(item)` gives every open, timed, one-off event whose title contains a match word a `prep` nudge `minutes_before` its start (key `prep:<rule>:<item>`), and cancels ones that no longer apply. Triggers on items (insert/update) and on settings (rules changed → every future event). Works for events from any source: typed, imported, AI.
- AI action `add_prep_rule` (planner: words and reminder required; duplicates skipped; applied with Undo like other settings changes). Prompt v4 describes it.
- Shown as "Before this: Bring €20 cash (12 h before)" on matching events, and listed with Remove in Settings → Prep reminders. Repeating events are left out for now (their reminders are made per occurrence by the scheduler).

## Sync watchdog (2026-11-08)

- On the owner's iPhone sync stopped at 20:36 and stayed stopped across restarts, on the latest build (which limits every request to 30 s) and with no error shown, so the hang is outside a network request. Nothing has reached the server from the phone since.
- Each run now records its step ("sending captures", "receiving items", "saving items", "uploading files"). A run that takes over 90 s is abandoned with "Sync stopped responding while <step>.", shown under the sync time, and the usual back-off retry starts a fresh run. Bookkeeping reads and writes around the run (last sync time, pending count) give up after 5 s.

## Sync now always kicks (2026-11-08)

- Owner: "Why doesn't the sync now button work and kick it into gear." Sync was single-flight: a tap during a run only asked for another run after it, so with a run hung the tap did nothing, and the button was disabled while the state said "syncing".
- `syncNow({ force: true })` (the Settings button) abandons a run older than 3 s: a generation counter makes the old run's late results change nothing (no status, no lastSyncedAt, no retry timer) while a fresh run starts at once. Automatic triggers still fold into one follow-up run.
- The button is never disabled. While syncing, Settings shows "Syncing since HH:MM: <step>".
- "Load latest version" asks the service worker to check for a new build, waits up to 10 s for it to take over, then reloads; for iPhone Home Screen apps that keep running a cached copy.

## Background sorting every 5 minutes (2026-11-08)

- Owner: the AI should run over new notes in batches every 5 minutes, only when there is something new, as cheaply as possible.
- Migration 0033: the 5-minute dispatcher now uses `users_due_now()` = due once the oldest waiting capture is 2 minutes old (so a burst shares one call) or 20 are waiting (a full batch). Before, it was 5 waiting or an hour. A person's own `batch_threshold_count` / `_minutes` settings still win. No unsorted capture → no call.
- Cost: one small-tier batch is roughly €0.002–0.005 (cached system prompt); the monthly cap still stops everything.

## Nothing lost: instant events tidied by AI (Task 11.1, 2026-11-08)

- `createCapture`: a **simple** note (one sentence, at most 8 words, no instruction words such as need, remind, still, then, also, plan; `isSimpleCapture`) keeps today's behaviour. A **longer** dated note still gets its instant event, but the capture stays `unsorted` with `payload.instant_item_id`. Undoing the instant event clears that id, so sorting treats the note afresh.
- Sorting sends such a capture as `<capture id=… instant_event="title | start (all day)">`; prompt v4 asks for that event first, with a clean title, the stated end and any repeat, then the other items. No new schema fields (union parameters unchanged).
- The planner turns that first event item into `SortPlan.item_updates` (only the columns that change: title, status, start_at, end_at, all_day, rrule; a suggestion becomes confirmed when the model is sure, a confirmed event is never demoted). If the person deleted the instant event it is not brought back; if the server has no such item the event is inserted as usual.
- Migration 0034, `apply_sort_batch` v4: applies an item update only while the capture is still unsorted and the item's `updated_at` equals `before.updated_at`; otherwise it is stored as a proposal ("Changed meanwhile; check before applying"). Each is logged in `ai_actions` as kind `tidy_item` (the kind check widened as in 0032) and counts in the returned `actions`. The kind is not in the model-facing action enum.
- Inbox and capture chip: "Tidied “Training” and added 1 item"; Undo and Apply use the existing paths (item columns now include title, status and rrule). The capture chip shows what sorting did before the instant-event label.
- Free rules: a stated time range sets `end_at` ("8pm-12pm" ends at midnight; "10pm-2am" runs past it); the item page shows the end ("Thu 20:00–00:00").
- The stand-in AI (`tests/mock-ai`) reads `instant_event` and answers the Training and Quiz notes.

## AI over every note (Task 11.0, 2026-11-09)

- Notes join the sorting batch: typed notes, meeting notes and ideas the person made in Airhead (not from a capture, not items found in a note, not condensed or archived, not handwritten), changed in the last 30 days, at most 5 per batch, oldest change first. "Changed" means the item or its document was written on the server (`server_updated_at`, the server's clock) after `items.data.ai_seen_at`. Device clocks never decide it.
- Only the text since the last look is sent. Each look stores `ai_seen_len` and `ai_seen_hash` (FNV-1a of the text seen) in the note's data. If the note still starts with that text, only what follows is sent; if earlier text was edited, the whole note is sent again. At most 1,500 characters, plus the title. Text typed during the few seconds of an AI call is caught by the next look only if more is added later (accepted).
- Wire format: notes go in `<note id="…" title="…">` blocks after the captures, with `</note>`, `</capture>` and `</article>` neutralised. Results reuse `results[]` with `capture_id` = `"note:<id>"`, so the schema gains only `digest` (nullable string): 9 union parameters, under the limit of 16. Prompt `sort-batch.v5`.
- Planner: items from a note get `capture_id` null, `note_id` and `data.from_note_id`; note or meeting items for a note are dropped (the note already exists); actions follow the same rules and are logged with `ai_actions.note_id` (new nullable column) and `payload.note_id`. The note's own text and title are never changed.
- `apply_sort_batch` v5 (migration 0035) applies note items and actions while the note exists, then stamps every note sent with `ai_seen_at = now()` whatever the answer (the stamp equals the item's new `server_updated_at`, so it is not itself a change). It returns `notes` only when notes were in the batch, so older callers and tests see the same shape. If the AI call fails, nothing is stamped and the next batch tries again. A note with nothing new (e.g. only its title changed) is stamped without an AI call.
- Cost guard: `users_due_now()` also makes a person due when a changed note's last change is at least 30 minutes old; otherwise notes only ride along with a batch that runs anyway. Sort now always looks at waiting notes, and the Inbox offers Sort now when the device sees a changed note (`notesWaitingForAi`), even with no capture waiting. App open still sorts only for captures.
- Digest: the batch's `digest` (one or two sentences, at most 300 characters) is stored through `add_memory_facts` as an active everyday fact with the new `memory_facts.source = 'digest'`; empty digests and exact duplicates (of a fact or of a proposed fact in the same batch) are skipped. The usual profile and relevant-fact retrieval feed it back; the weekly review treats it like other facts.
- 11.1 follow-up: `target_item_index` now counts a capture's items in the model's order, with the tidied instant event in its place (index 0 when returned first, as the prompt asks). A reminder on it is applied together with the tidy-up (the tidy carries `data`, one freshness check, Undo restores both); with nothing to tidy it is an ordinary freshness-checked change to the existing event.

## Workshop routing (Task 11.2, 2026-11-09)

- **Buttons.** "Send to Workshop" on each capture in Capture's recent list and on each Inbox Unsorted card, on the item page and in a row under a note's title. The item page wording changes from "Send to the Workshop" to "Send to Workshop" (and "Take out of Workshop") so all four read the same.
- **A capture sent by hand** (`sendCaptureToWorkshop`): if sorting already made a note or idea from it, that item goes to the Workshop; otherwise a new `note` item is made with the capture's first line as title (capitalised, ≤ 80 characters) and the full text, word for word, in `body`, linked by `capture_id`, `data.workshop = true`, `data.workshop_from = 'manual'`. The capture becomes `sorted` with `payload.workshop_item_id` and `payload.workshop_reason`. A second tap finds the linked item and changes nothing. Events and tasks from the capture are left as they are.
- **AI routing.** Prompt `sort-batch.v6` asks for `suggest_workshop` on rough plans, open questions and "still need to plan" placeholders (already mapped to `data.workshop`), and for a new nullable string `leftover` per result: the words no item or action covers. Union parameters go from 9 to 10 (limit 16). Older saved answers without `leftover` still plan (`SortAnswer` makes it optional); the fixtures were given `leftover: null`.
- **Planner** (`planSort`, new `ctx.texts`): a capture with no items, no actions and not a link, and a capture the model skipped altogether, become a Workshop note from the full text, and the capture is `sorted` (was `needs_review` / `failed`, which left it stuck). A non-empty `leftover` becomes a Workshop note titled from the leftover, its body the whole capture, unless it only repeats an item's title. Without `ctx.texts` (older callers) the old statuses stay. Web pages never route. For a typed note (`note:<id>`), a leftover marks the note itself for the Workshop; a note that asks for nothing is left alone (the note is already kept).
- **Applying.** The notes are ordinary planned items, so `apply_sort_batch` inserts them in the same transaction. Migration 0036, `apply_sort_batch` v6 (v5 copied), adds `p_plan.workshop` `[{capture_id, item_id, reason}]`: for a capture still unsorted whose note was inserted, `payload` gets `workshop_item_id` and `workshop_reason` (`unmapped` or `leftover`). `p_plan.notes[].workshop = true` sets the note's `data.workshop` when it is stamped as seen.
- **Chip.** "Sent to Workshop" for a capture sent whole (by hand or unplaced); for a leftover it is added after what sorting did, e.g. "Tidied “Christmas sandwiches” · Sent to Workshop" or "Sorted · Sent to Workshop".
- The stand-in AI answers the placeholder note with a weekly event plus `leftover` "Still need to plan", and "hmm …" with nothing.

## Real-model evaluation on dev (2026-11-09)

- The owner asked that requests like theirs be tested in their environment, not only against the stand-in AI. `supabase/functions/ai-eval` sends 14 of the owner's own requests (leave balance, haircut and cash, training plus report, quiz with times, birthday, Christmas placeholder, dentist moved, two team meetings, off 22-24 Dec, entitlement, WFH Mondays, shopping, a note about Trevor, a vague note) through the real prompt, schema, model and planner in one small-tier call (about a cent), and reports per request what it became and what is wrong. It writes nothing: no database access, no usage rows.
- Dev only, no new secrets: the cron job `ai-eval` (migration 0037, twice an hour) calls the function with the service key from Vault only when the Vault project URL is the dev project; the function also refuses on live. The model is called only when the prompt or the cases changed since the last saved run, or once a day, so a quiet half-hour costs nothing. Reports go to `ai_eval_runs` (no app access; read with read-only queries). An earlier version used an `EVAL_TOKEN` secret; setting secrets needs the owner, so this design replaced it.

## UI foundation (Task 11.U1, 2026-11-09)

- Owner: every page should feel like a polished personal organiser (Apple Reminders/Calendar, Things, Todoist): calm, legible, consistent, phone first, light and dark. This task builds the foundation and the shell; later steps move each page onto it, calendar first.
- Split into two PRs: (1) tokens, components, design kit; (2) app shell, PageHeader on every page, Settings rebuilt on the components.
- **Tokens** live in `src/index.css` as Tailwind v4 `@theme static` variables, so every role is both a CSS variable and a utility (`bg-surface`, `text-fg-muted`). Text roles are called `fg`, `fg-muted`, `fg-subtle` (a role named `text` would give `text-text`). Dark values are set unlayered under `prefers-color-scheme: dark` and under `[data-theme="dark"]`, so a subtree can force a scheme; `[data-theme="light"]` does the reverse. Components in `src/ui/` use only roles, never `dark:` utilities, which is what lets the design kit show both schemes side by side. The `dark:` variant stays on the media query, so existing pages are unchanged.
- **Values**: iOS system greys (canvas `#f2f2f7` / black, surface white / `#1c1c1e`), the existing indigo as accent (`indigo-600`, `indigo-400` in dark). System font stack with `-apple-system` first. Type scale title 30 px, headline 17 px, body 16 px (not 17: 16 px is the smallest input size iOS Safari does not zoom into, and body and fields share it), footnote 13 px, caption 12 px.
- **Components** (`src/ui/`, one per file, no new libraries): Button, IconButton, Card, Chip/Badge, SegmentedControl (ARIA radio group with roving tabindex), Sheet (portal; bottom sheet below 768 px, centred dialog above; own focus trap rather than `<dialog>`, whose top-layer and focus behaviour differ in jsdom and older iOS), EmptyState, Toast, TextField/TextArea/Select/Toggle (shared label, hint and error wiring), Section/GroupedList/ListRow, PageHeader. React 19's `useEffectEvent` keeps the toast timer from restarting when the parent re-renders.
- **Toast**: the Capture "Event added · Undo" toast now uses `ui/Toast`; `TOAST_MS` (8 s) moved there and `features/capture/toast.ts` re-exports it so its test mock still works.
- **Design kit** at `/ui`, linked from Settings → About. Not dev-only: it is one small page, and it lets the owner check both schemes on the phone.
- PageHeader reports its title through `CompactTitleContext` once the large title has scrolled out of view (IntersectionObserver, clipped by the scrolling `main`); the phone shell shows it small in the top bar. Without a shell it does nothing.
- **Bundle split.** With this PR the main bundle passed Workbox's 2 MiB precache limit in a server build (2.1 MB; local-mode builds are smaller, so it only showed in CI and Cloudflare). `vite.config.ts` now puts libraries in their own chunks (`editor`, `calendar`, `files`, `vendor`; largest about 0.8 MB). They are still loaded up front and precached, so offline use is unchanged; pdfjs stays on demand. Route-level lazy loading is left for later.

### App shell (Task 11.U1, part 2)

- Same routes, tab order and places as before: phone tabs Capture, Today, Inbox, Library, Insights; Calendar and Settings as icon links in the phone top bar; sidebar on iPad and desktop with Calendar after Today and Settings at the bottom; the desktop side panel stays.
- Tab bar: 49 px tall (iOS), translucent surface with blur, accent colour for the current tab, safe-area padding on bottom and sides. Sidebar: surface panel, current item on `accent-soft`.
- **Inbox badge** (`useInboxCount`): captures waiting (`unsorted`, `failed`), unsure items waiting for a tap, memory facts waiting for approval: the same three things the Inbox shows first. It is `aria-hidden`, so the link's accessible name stays "Inbox" and tests and screen readers find it as before. AI action proposals and Workshop items are not counted (they are not urgent).
- **Compact title**: the phone top bar shows the brand; once the page's large title has scrolled out of view, it shows the title instead (the PageHeader reports it through `CompactTitleContext`). The small copy is `aria-hidden`; the page's h1 stays the only heading.
- `Page` now renders `PageHeader` (title, and optional `actions` and `back` for the page-by-page steps). No page content changed except Settings.
- **Settings** is the worked example: Account, Devices, Sync and About are grouped lists with rows, chips and shared buttons; the panels whose insides are not yet rebuilt (Security, Notifications, Today, Work, …) sit in a `Card` under a `Section`. Accessible names are unchanged (Sign out, Sync now, Load latest version, the Devices list).
- The sync indicator keeps its text and sits in the phone top bar and under the sidebar brand, as before.

## Calendar: easier viewing, find and filter, missing events (Tasks 11.3, 11.6, 11.7, 2026-11-09)

- **Our own header, FullCalendar for the grids.** The page owns the view (`day`, `week`, `month`, `agenda`) and a day key; `src/lib/calendar/view.ts` turns them into the period, the title ("9–15 Nov 2026", "30 Nov – 6 Dec 2026", "November 2026", "Mon 9 Nov 2026") and previous / next. FullCalendar draws Day and Week everywhere and Month on iPad and desktop, and follows our state through `changeView` / `gotoDate`. The Agenda and the phone's Month are drawn by Airhead from `buildEvents`, so they need no FullCalendar list view (removed).
- **Views** use the shared `SegmentedControl`. Defaults stay: Agenda on the phone, Week on iPad and desktop. The choice is remembered per device in `localStorage` (`airhead.calendar.view`), read and written inside try/catch.
- **Week and Day** show the red now line (`nowIndicatorLineClass` `ah-now-line`, 2 px) and open at the hour before now (`scrollTime`, plus `scrollToTime` once the grid has its size, so the phone opens there too). The all-day row stays at the top.
- **Swipe**: a quick horizontal touch swipe (over 60 px, mostly horizontal, under 0.7 s) on Day, Week or Month moves one period. Not on the Agenda, which scrolls. In Month, coming back to this month selects today again (as Apple Calendar does).
- **Phone month** (Apple style): a grid of days with one dot per calendar colour that has something on (up to three), today in red, the selected day filled; the selected day's events listed underneath. iPad and desktop keep FullCalendar's month grid with event chips and drag-select ("Book as leave").
- **Agenda**: 30 days from the anchor day, grouped by day under sticky headers ("Today", "Tomorrow", "Thu 12 Nov", with the year when it differs), all-day first then by time, a long event on each day it covers ("Until 02:00" on its last day); time, end time, source colour bar, repeat icon and location. An IntersectionObserver at the end (and a "Show more" button) loads 30 more days, up to about a year. Empty: an EmptyState.
- **Event details** (`EventDetails`, a `Sheet`): title, when with end time, repeat in words (`rrule`'s `toText`, capitalised), calendar with its colour, reminder (timed events), prep reminders (`prepRulesFor`, as in the editor: not for repeating events), location, notes, and Start / Open notes. Buttons: Edit (opens the existing editor), Delete (asks first; a repeating event says it deletes all its repeats, today's behaviour, until 11.5 adds this one / all), Send to Workshop (then a link to it). Time blocks have Edit and Send to Workshop. Linked-calendar events and public holidays are read-only and say where they come from. **Leave** shows its type and status with an "Edit leave" button, so leave can still be changed from the calendar (it used to open the leave form straight away).
- **Forms** moved onto the shared components: the editor and leave form sit in a `Sheet` on every layout (they used to sit in the desktop side panel), the editor uses `TextField`, `Select`, `TextArea`, `Toggle` ("All day" is now a switch) and `Button`. `LeaveSheet` has an `inSheet` prop to leave out its own title and Close. Repeat choices and behaviour are unchanged (part B, 11.4 / 11.5).
- **Search** (`searchEvents`): case-insensitive title match over calendar items and linked-calendar events, past and future, local and instant. A repeating event is listed once, at its next time. Upcoming first (soonest first), then Past (latest first), 50 each. Hidden calendars are searched too, so nothing seems lost. Suggestions (unsure dates) are not calendar events and are not searched.
- **Calendars panel**: a `Toggle` and colour for Personal, Us, Time-blocked tasks, Public holidays, Leave and each linked calendar; a Sheet on the phone (filter button in the header), the side area on iPad and desktop above "Tasks to plan". Remembered per device as before (`airhead.calendar.hidden`). When any calendar is hidden the page says so ("Personal is hidden." / "2 calendars are hidden.") with Show all.
- **Missing events (11.7), what was checked.** The owner's three events ("Quiz every Thursday 8pm-12pm" weekly, "Niamh's Birthday 11/11" yearly all-day, "Training on Tuesday" all-day) were rebuilt as the server returns them (offset timestamps with microseconds, all-day items at local midnight, the quiz with and without `end_at`) and drawn in a real browser in every view, at phone and desktop width, through view switches, previous / next, Today, hiding and showing a calendar and saving a new event: they never disappeared. `buildEvents` gives every occurrence its own stable id (`<item>|<occurrence>`), so re-renders cannot merge them. Time zone: all-day items are local midnight, and Dublin is UTC in November, so midnight UTC and local agree. Status: only open events are drawn; "Training on Tuesday" with no time and no all-day word is an unsure date, so it is a suggestion on Today ("Add to calendar") until confirmed, not a calendar event.
- **Causes found and fixed on the client**: (1) the calendar toggles were small chips with a hidden checkbox and were remembered per device with no sign of being off, so one stray tap hid a whole calendar on that device only, which matches "showed, then went missing, server intact"; the panel now shows each toggle as a switch and the page says what is hidden. (2) The phone's default Agenda showed only 14 days, so a birthday three weeks away was not there; it now shows 30 days and loads more. (3) There was no way to look an event up; search now finds it whatever is hidden.
- **Proof**: `lib/calendar/view.test.ts` "missing events" (all three in Day, Week, Month and Agenda, next week and next year, stable occurrence ids, hidden is the only thing that removes them and search still finds them); e2e sync `calendar.spec.ts` makes the three events in the desktop editor on device A and checks every view on A, on B (a phone already on the calendar, then after a reload) and on A after its pull has replaced its rows with the server's.

## Calendar: faster adding (Task 11.4, 2026-11-09)

- **Quick add** is a box at the top of the calendar, on every layout. It runs the Capture rules (`analyseCapture`, so time ranges, recurrence and British dates behave exactly as in Capture) and shows a live preview: title, when (with end), repeat in words and calendar. Enter or Add saves an open Personal event; a toast says "Added “Quiz”" with Undo (soft delete). Quick add does not go through `createCapture`: it makes a calendar event, not a capture to sort, so nothing is left in the Inbox.
- Choices: a timed event with no stated end gets an hour (as a tapped slot does), unlike a captured note's instant event, which keeps no end. Text with no date or time still adds an event, at the next whole hour today (or 09:00 on the chosen day in Day and Month views) and the preview says "(no date found)". The calendar is always Personal; More options opens the full form, filled in, to change it. An empty title (only a date was typed) cannot be added.
- **Tap to create**: FullCalendar's `dateClick` now handles a single tap or click on an empty slot (an hour from there) or a month day (all day), on touch too; `select` handles only drags across more than one slot or day (spans, and "Book as leave"). Before, a phone needed a long press. The phone's own month has an "Add event" button for the chosen day (09:00, or the next hour today); tapping a day still just selects it, as in Apple Calendar.
- **Event form** repeat fields: Repeats (Does not repeat, Every day/week/month/year: the select keeps its `FREQ=…` values), Every N, weekday chips for weekly (the start's weekday chosen to start with), End repeat (Never, On a date, After a number of times) and the rule in words under it. Rules live in `src/lib/calendar/repeat.ts`; UNTIL is written as the end of the local day in floating time (`YYYYMMDDT235959Z`), the same wall-clock encoding the calendar and the reminder job use to expand rules. A rule the form cannot show (say `FREQ=HOURLY`) shows as "Custom (…)" and is saved unchanged unless the repeat is changed. Parts the form does not edit (BYMONTHDAY) are kept.
- **Repeat in words** (`repeatWords`) is now our own British wording ("Every Thursday", "Every 2 weeks on Mon and Thu", "Every weekday", "Every month on the 1st", "Every year on 11 Nov", "… until 31 Dec", ", 5 times"); anything it cannot word falls back to rrule's English. The library's lower-case `repeatText` is unchanged.



## Calendar: repeating events done right (Task 11.5, 2026-11-09)

- **No migration.** The spec's model fits the existing row: `items.data` is free JSON that already syncs whole through the outbox and pull, so no new columns, no Dexie version bump and no pgTAP change. An exception is the occurrence's original start (plain UTC ISO, as `expandOccurrences` makes it) in the series' `data.exdates`. A changed occurrence is that exception plus a one-off item with `data.parent_id` (the series) and `data.recurrence_id` (the original start). This mirrors RFC 5545 EXDATE and RECURRENCE-ID without a second UID. Last write wins per row, as for every other edit.
- **Logic** is pure in `src/lib/calendar/occurrence.ts` (`planEdit`, `planDelete` return the rows to write) and applied by `src/lib/db/recurring.ts` through `save`, so every row goes to the outbox. `expandOccurrences` skips exceptions, so Day, Week, Month, Agenda and search all honour them.
- **This event**: exception + one-off (copies title, notes, calendar, location, reminder; times and fields from the form). **This and following**: the old rule gets `UNTIL` the end of the local day before the occurrence (floating, like 11.4); the new series starts at the occurrence with the form's fields; a `COUNT` rule continues with the times left; if the occurrence moved to another weekday, a weekly `BYDAY` moves with it; later exceptions and changed occurrences move to the new series (re-pointed `parent_id`). From the first occurrence it means all. **All events**: the series moves by the same number of local days and to the new local time of day (wall clock, so a move made in November is right in July too); exceptions move with it; `BYDAY` moves too. Deleting all also deletes the series' changed occurrences; deleting this and following deletes the later ones.
- **Where it asks**: the details sheet's Delete (the old "delete all its repeats" confirm is gone for repeating events), the form's Save and Delete when opened from an occurrence (inline, in place of the buttons: "Save for which events?"), and a drag or resize of an occurrence in Day, Week or Month (a sheet "Move which events?"; Cancel or closing puts it back). Repeating events are now draggable. When the repeat rule itself changed in the form, "This event" is not offered (one event cannot have its own rule).
- The form opened from an occurrence shows that occurrence's date and time (it used to show the series' first date).
- **Server**: the reminder job (`scheduler-tick`) skips exceptions, so a deleted occurrence does not ping; a changed one-off gets its own reminder from the existing trigger. The subscribed feed writes `EXDATE` lines (with `TZID` for timed events, `VALUE=DATE` for all-day); changed occurrences are already their own events. **Not done**: the morning brief builds its recurring list in SQL (`morning_digest`, migration 0016) without `data`, so it may still mention a deleted occurrence. Fixing it needs a migration to replace that function; left out of this PR to keep it migration-free (another session was adding migrations). **Done in migration 0038**: the digest passes each series' `exdates` and the brief skips them.
- **Repeat in words** now shows in the details sheet with the start's day ("Every Thursday"), and under each repeating event in the Agenda and the phone month's day list, also as the repeat icon's tooltip.

## Contract test for every AI call (TEST-MATRIX gap 2, 2026-11-09)

- **How**: `_shared/ai.contract.test.ts` runs each function's own entry point (`runAsk`, `runFleshOut`, `runTurn`, `buildBrief`, `buildReview`, `runImport`, `runSummarise`, `runSuggestLeave`, `scoutWeb`; check-contradictions through `callAI` with its prompt, schema and `validConflicts`, since its logic sits in `index.ts`) with fake stores but the real client from `anthropicClient`, pointed at `tests/mock-ai`. So the real prompt, the real Zod schema as the SDK serialises it, the real HTTP request and the function's own parser and clean-up are all exercised.
- **The stand-in** (`tests/mock-ai/server.mjs`) finds the task by the start of its fixed system prompt (a table, `TASKS`) and answers from `tests/fixtures/ai` (read when needed, so the e2e job and Deno share the same answers). Summarise answers the handwritten fixture when the request carries an image block. Scout is found by its `web_search` tool: the stand-in checks the tool type looks like `web_search_YYYYMMDD` with `max_uses` of at least 1, and answers one `server_tool_use` per query plus the saved final text, with `web_search_requests` in usage.
- **Drift check**: before answering, the stand-in checks the saved answer against the JSON schema the request sent (types, required, `additionalProperties: false`, enums, `anyOf`, `$ref`); a mismatch is a 400, so a schema change that the fixtures no longer fit fails the test instead of passing on a stale answer. The real API only ever returns output that fits the schema, so this is what it would do.
- **New fixtures**: `leave.json`, `scout.json` (one `http://` idea and a third idea that the parser must drop) and a `turn` answer in `workshop.json`. Existing fixtures are reused unchanged.
- The e2e-sync job uses the same stand-in, so Ask, Workshop, summaries and the rest now get answers there too instead of a 400. No e2e test relied on the 400.
- No PLAN.md task covers the TEST-MATRIX gaps, so nothing is ticked there.

## Handler tests for every Edge Function (TEST-MATRIX gap 8, 2026-11-09)

- **Refactor, not import tricks**: each `index.ts` called `Deno.serve` at import time with a module-level Supabase client, so its handler could not be imported in a test. The request handling moved, unchanged, into `<function>/handler.ts` as `handleX(req, deps)`; `index.ts` keeps the client and the Supabase-backed deps and calls `Deno.serve((req) => handleX(req, deps))`. `health` and `calendar-feed` already worked this way.
- **Shared seams**: `_shared/caller.ts` (a `Caller` with `userId(token)` and `isService(token)`, `bearer(req)`, and `supabaseCaller(db, isService?)`; user-only functions leave `isService` out, so they never probe as before) and `_shared/userOrService.ts` (the start shared by morning-brief, weekly-review and scout: service key + `user_id`, or a user with the right `mode`). `_shared/testing.ts` has the fake caller (two users and a service key), request builders and fake AI and usage stores.
- **Deps are narrow**: a handler gets the run function's own deps (ask, workshop, import, summarise, suggest-leave) so bad JSON goes through the real validation, or a closure for the heavy work (sorting, brief, review, scout, tick, embedding, evaluation), plus the lookups that decide ownership (read-link capture, send-push device, linked feeds). The fakes mirror the real queries' owner filters, so "another user's id is not found" is the handler passing the token's user, never the body's.
- **Behaviour kept as it was**, including two oddities now written down by tests: sort-batch with the service key and no (or unreadable) body answers 401, not 400; a user token posting a service-style send to send-push gets 400 (bad request), not 401. Not changed here to keep this PR behaviour-free.
- check-contradictions' AI call now lives in its handler, so its contract test could call the handler; it still calls `callAI` with the same prompt and schema.

## Background sorting and the monthly cap, end to end (TEST-MATRIX gaps 6 and 19, 2026-11-09)

- **Vault in CI only, with local values.** The e2e-sync job writes `project_url` = `http://kong:8000` (Kong's name inside the stack's Docker network, where `pg_net` runs) and `service_role_key` = the CLI's well-known local demo key from `supabase status`. No real secret is involved and nothing touches dev or live.
- **pg_cron's schedules are stopped in that job** (`cron.unschedule` on every job). With Vault filled, the real schedules would start sorting, briefs, reminders and embeddings for every test user every few minutes, racing the tests' own Sort now taps. The tests run the dispatcher themselves: `select public.dispatch_sort_batches()`, the exact SQL the schedule runs. That pg_cron fires it stays proven by `db/0005`.
- **The clock is stood in for, not the threshold.** Writing `batch_threshold_count` into `settings` behind the device's back could make a server row that clashes with the device's own settings row (`settings_one_per_user`). Instead the test moves the capture's `captured_at` back 10 minutes, so `users_due_now` (oldest settled for 2 minutes) picks it up. The test checks `users_due_now` names the user before dispatching.
- **Cap**: the month's spend is one `ai_usage` row of €1 written by SQL (standing in for earlier calls); the €0.50 limit is set through the app's own Insights → AI usage form, so device → settings → `sort-batch` is real. Proof that the batch was skipped: an `ai_usage` row with `cap_reached`, the capture still `unsorted`, no items, and Sort now showing the limit message.
- **Database access from Playwright** goes through `psql` and `SUPABASE_DB_URL` (`tests/e2e-sync/db.ts`); the runner image has the PostgreSQL client. Waits on `sort-batch` print `net._http_response` on time-out, so a failing call says why.
- No PLAN.md task covers the TEST-MATRIX gaps, so nothing is ticked there.

## Every synced table and capture tokens, end to end (TEST-MATRIX gaps 12 and 16, 2026-11-09)

- **The table list is the sync engine's own** (`SYNC_TABLES` from `src/lib/schemas/records.ts`). The test's rows are a `Record<SyncTable, …>`, so a new synced table without a row fails `tsc`, and the test also checks the keys match at run time. Each row is checked against the app's Zod schema first, so the test cannot pass on a row the app would never make.
- **Device writes go in through raw IndexedDB**, the same two writes every app save makes (the row and an outbox entry in one transaction), then the `online` event starts the engine. Going through each screen for 18 device tables would test the UI, not sync, and would break whenever the UI changes (another session is redoing it). The push and pull, PostgREST, RLS and Realtime are all real.
- **Server-only tables** (`external_events`, `briefs`, `reviews`, `scout_runs`: devices may only read them) get their row by SQL (`jsonb_populate_record`), standing in for the functions that write them; they must still reach B.
- **What counts as the same**: every field sent, with timestamps compared as instants (PostgREST writes `+00:00`, devices `Z`); `server_updated_at` and the server-numbered `version` of note docs and drafts are skipped, and the test checks both came back as 1. Settings change the device's own row, since there is one per user.
- **Rows are inert**: the capture is already sorted, the linked calendar is switched off, the suggestion and AI action are dismissed, dates are in 2031, so no sorting, fetching or reminder reacts during the test.
- **Capture tokens**: the token is read from the app's "shown once" panel and posted with Playwright's `request` to the local `ingest-capture`, as an iOS Shortcut would. The test also checks the server holds only a hash, the device receives the capture, "Last used" changes, and after Revoke the same token gets 401 and saves nothing.
