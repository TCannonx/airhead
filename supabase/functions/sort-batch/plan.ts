import {
  type FollowUpT,
  NOTE_PREFIX,
  readAction,
  type SortAnswer,
  type SortAnswerItem,
  type SortedItemT,
} from '../_shared/schemas/sort.ts';
import { type ActionContext, type NewItemRef, type PlannedAction, planActions } from './actions.ts';

/** An event is created straight away only from this confidence up (otherwise a suggestion). */
export const EVENT_CONFIDENT = 0.8;
/** Below this, the item is a one-tap choice and the capture needs review. */
export const REVIEW_BELOW = 0.6;

export interface PlanContext {
  now: Date;
  /** The person's time zone (default Europe/Dublin). */
  timeZone?: string;
  topics: { id: string; name: string }[];
  lists: { id: string; name: string }[];
  ideas: { id: string; title: string }[];
  /**
   * The event the instant rule made for a longer capture (payload.instant_item_id),
   * by capture id, as the server holds it now (Task 11.1).
   */
  instant?: Map<string, InstantRow>;
  /** Notes sent in this batch (Task 11.0): stamped as seen whatever the answer. */
  notes?: NoteSeen[];
  /**
   * Each capture's text, by id (Task 11.2): what the batch could not place is
   * kept as a Workshop note. Without it, an unplaced capture fails as before.
   */
  texts?: Map<string, string>;
  /**
   * Captures that answer an earlier question (Task 12.2), by capture id. The
   * answer is added to the item's details, and at most one more round is asked.
   */
  answers?: Map<string, AnswerContext>;
}

/** What an answer capture answers (Task 12.2). */
export interface AnswerContext {
  follow_up_id: string;
  question: string;
  /** The round of the question answered (1 = asked about the original note). */
  round: number;
  /** The item the question was about, as the server holds it now; null if gone. */
  item: { id: string; title: string; body: string | null; updated_at: string } | null;
}

/** At most this many questions per note, and quick answers per question (Task 12.1). */
export const MAX_FOLLOW_UPS = 3;
export const MAX_OPTIONS = 4;
/** Questions stop after this round: an answer may bring one more, no more (Task 12.2). */
export const MAX_ROUNDS = 2;
/** Checklist steps on a planning task. */
export const MAX_STEPS = 5;

/** A question to the person, written by apply_sort_batch into follow_ups (Task 12.1). */
export interface PlannedFollowUp {
  id: string;
  capture_id: string | null;
  note_id?: string;
  /** The item it is about (new in this batch or existing), or null. */
  item_id: string | null;
  question: string;
  options: string[];
  round: number;
}

/** Generic questions never help (spec 12.1: "never generic"). */
const GENERIC_QUESTION =
  /^(?:is there )?(?:anything|something) else\b|^any (?:other|more|further) (?:details|info|information|thoughts)\b|^(?:can|could) you (?:tell me|give) more\b/i;

/** Cleans the model's questions: specific, short, at most 3, at most 4 quick answers each. */
export function cleanFollowUps(raw: FollowUpT[] | undefined, max = MAX_FOLLOW_UPS) {
  const out: { question: string; options: string[]; about_item: number }[] = [];
  for (const f of raw ?? []) {
    const question = f.question.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!question || GENERIC_QUESTION.test(question)) continue;
    if (out.some((o) => norm(o.question) === norm(question))) continue;
    const options = [
      ...new Set(f.options.map((o) => o.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean)),
    ].slice(0, MAX_OPTIONS);
    out.push({ question, options, about_item: Number.isInteger(f.about_item) ? f.about_item : -1 });
    if (out.length >= max) break;
  }
  return out;
}

/** A planning task's checklist, as the item body: one "- [ ] step" line each. */
export function checklistBody(steps: string[]): string {
  return steps.map((s) => `- [ ] ${s}`).join('\n');
}

/** A note looked at by this batch, and what it looked like (Task 11.0). */
export interface NoteSeen {
  id: string;
  /** Length of the note's text at this look; the next look sends what follows. */
  seen_len: number;
  /** Hash of that text, to tell an addition from an edit next time. */
  seen_hash: string;
  /** Set when the note had words to plan that fit no item: it goes to the Workshop (Task 11.2). */
  workshop?: true;
}

/**
 * A capture whose words went to the Workshop (Task 11.2): apply_sort_batch
 * stores the note's id and the reason in the capture's payload, for its chip.
 */
export interface WorkshopRoute {
  capture_id: string;
  item_id: string;
  /** 'unmapped': nothing in it could be placed; 'leftover': only part of it. */
  reason: 'unmapped' | 'leftover';
}

export interface InstantRow {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  rrule: string | null;
  updated_at: string;
  deleted_at: string | null;
  /** Its data, so a reminder set by the same capture keeps the rest (Task 11.0). */
  data?: Record<string, unknown>;
}

/** Columns sorting may tidy on an instant event. */
const TIDY_COLUMNS = ['title', 'status', 'start_at', 'end_at', 'all_day', 'rrule'] as const;

/**
 * Sorting's tidy-up of an instant event (Task 11.1): applied by apply_sort_batch
 * only if the item's updated_at still equals before.updated_at, and logged as an
 * ai_actions row of kind tidy_item (so the Inbox can Undo it).
 */
export interface ItemUpdate {
  /** The ai_actions row id. */
  id: string;
  capture_id: string;
  item_id: string;
  summary: string;
  quote: string;
  confidence: number;
  /** The changed columns as they were, plus updated_at for the freshness check. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface PlannedItem {
  /** Made here so actions (a reminder on a new event) can point at it. */
  id: string;
  /** Null for items found in a note (then note_id is set). */
  capture_id: string | null;
  /** The note this item was found in (Task 11.0). */
  note_id?: string;
  type: SortedItemT['type'];
  title: string;
  body: string | null;
  status: 'open' | 'suggested';
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  due_at: string | null;
  rrule: string | null;
  calendar: 'personal' | null;
  list_id: string | null;
  topic_names: string[];
  confidence: number;
  data: Record<string, unknown>;
}

export interface ReadingUpdate {
  capture_id: string;
  summary: string;
  key_points: string[];
  topic_names: string[];
}

export interface ProposedFact {
  text: string;
  category: 'everyday' | 'person' | 'personal';
  source_capture_id: string | null;
  /** 'digest' for the batch's digest (Task 11.0); otherwise absent. */
  source?: 'digest';
}

export interface SortPlan {
  items: PlannedItem[];
  /** Status for each unsorted capture in the batch. */
  captures: { id: string; status: 'sorted' | 'needs_review' | 'failed' }[];
  /** Topic names to create (not already existing, case-insensitive). */
  new_topics: string[];
  /** Summaries for saved web pages (their reading items get these). */
  reading_updates: ReadingUpdate[];
  /** Saved web pages processed in this batch (their stored text is cleared). */
  link_captures: string[];
  /** Memory facts from typed captures only (never from web pages). */
  facts: ProposedFact[];
  /** AI actions with their checks done (Phase 10). */
  actions: PlannedAction[];
  /** Instant events tidied by this batch instead of new ones (Task 11.1). */
  item_updates: ItemUpdate[];
  /** Notes to stamp with ai_seen_at (Task 11.0), whatever the answer said. */
  notes: NoteSeen[];
  /** Captures whose words went to the Workshop (Task 11.2). */
  workshop: WorkshopRoute[];
  /** Questions about notes that imply more work (Task 12.1). */
  follow_ups: PlannedFollowUp[];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * A Workshop note's title from captured words: the first line, capitalised,
 * at most 80 characters. Same as the app's workshopTitle.
 */
export function workshopTitle(text: string): string {
  const line =
    text
      .trim()
      .split('\n')[0]
      ?.trim()
      .replace(/[.\s]+$/, '') ?? '';
  const short = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : 'Untitled';
}
const cleanTopics = (topics: string[]) =>
  [...new Set(topics.map((t) => t.trim()).filter(Boolean))].slice(0, 3);

/** 09:00 tomorrow in the time zone, as UTC ISO: the first reminder of a repeat with no date. */
export function tomorrowMorning(now: Date, timeZone: string, daysAhead = 1): string {
  const local = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(d)
      .replace(', ', 'T');
  const day = local(new Date(now.getTime() + daysAhead * 86_400_000)).slice(0, 10);
  // Start from 09:00 UTC that day and correct by the zone's offset at that time.
  const guess = Date.parse(`${day}T09:00:00Z`);
  const offsetMs = Date.parse(`${local(new Date(guess))}:00Z`) - guess;
  return new Date(guess - offsetMs).toISOString();
}

/** 09:00 on a local date (YYYY-MM-DD) in the time zone, as UTC ISO. */
export function nineOn(ymd: string, timeZone: string): string {
  const guess = Date.parse(`${ymd}T09:00:00Z`);
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(guess))
    .replace(', ', 'T');
  const offsetMs = Date.parse(`${local}:00Z`) - guess;
  return new Date(guess - offsetMs).toISOString();
}

/**
 * When a planning task is due (Task 12.1): before the first occurrence of the
 * event it is for (09:00 the day before, or 09:00 that day, or the start, the
 * first that is still ahead), never later than that; with no event, the model's
 * date if it is ahead, else 09:00 in 3 days.
 */
export function planningDue(
  modelDue: string | null,
  eventStart: string | null,
  now: Date,
  timeZone: string,
): string {
  const ahead = (iso: string | null) => iso !== null && Date.parse(iso) > now.getTime();
  if (eventStart && ahead(eventStart)) {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(eventStart));
    const before = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const latest =
      [nineOn(before, timeZone), nineOn(day, timeZone)].find(
        (t) => ahead(t) && Date.parse(t) < Date.parse(eventStart),
      ) ?? eventStart;
    return modelDue && ahead(modelDue) && Date.parse(modelDue) <= Date.parse(latest)
      ? modelDue
      : latest;
  }
  return modelDue && ahead(modelDue) ? modelDue : tomorrowMorning(now, timeZone, 3);
}

/** Birthdays and anniversaries repeat every year even when the model leaves rrule out. */
export function yearlyByNature(type: string, title: string): string | null {
  return type === 'event' && /\b(?:birthday|b-?day|anniversary)\b/i.test(title)
    ? 'FREQ=YEARLY'
    : null;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * First due time of a repeating task with no date: 09:00 on the next day the
 * rule allows ("every Friday" starts on a Friday), from tomorrow on.
 */
export function firstDue(rrule: string, now: Date, timeZone: string): string {
  const byday = /BYDAY=([A-Z0-9,+-]+)/i.exec(rrule)?.[1];
  const days = byday ? new Set(byday.split(',').map((d) => d.slice(-2).toUpperCase())) : null;
  if (days) {
    for (let ahead = 1; ahead <= 7; ahead++) {
      const at = tomorrowMorning(now, timeZone, ahead);
      const name = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
        .format(new Date(at))
        .slice(0, 2)
        .toUpperCase();
      if (days.has(name) && WEEKDAYS.includes(name)) return at;
    }
  }
  return tomorrowMorning(now, timeZone);
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Same instant or value (timestamps compared as times; the database writes them differently). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && /^\d{4}-/.test(a) && /^\d{4}-/.test(b))
      return ta === tb;
  }
  return (a ?? null) === (b ?? null);
}

/**
 * The tidy-up of an instant event from the model's first event item for that
 * capture: only the columns that change. A suggestion becomes a confirmed event
 * when the model is sure; a confirmed one is never demoted.
 */
function tidyOf(row: InstantRow, planned: PlannedItem): Record<string, unknown> {
  const want: Record<(typeof TIDY_COLUMNS)[number], unknown> = {
    title: planned.title,
    status: row.status === 'suggested' && planned.status === 'open' ? 'open' : row.status,
    start_at: planned.start_at ?? row.start_at,
    end_at: planned.end_at,
    all_day: planned.all_day,
    rrule: planned.rrule,
  };
  return Object.fromEntries(
    TIDY_COLUMNS.filter((k) => !same(want[k], row[k])).map((k) => [k, want[k]]),
  );
}

/**
 * Turns the model's answer into rows, applying Airhead's own rules (the model
 * suggests, the rules decide): confident future events are created, anything
 * unsure becomes a suggestion, unknown lists ask first, topics are reused.
 * Anything derived from a saved web page (untrusted content) is only ever a
 * suggestion.
 */
export function planSort(
  captureIds: string[],
  result: SortAnswer,
  ctx: PlanContext,
  linkIds: string[] = [],
  actx?: ActionContext,
): SortPlan {
  const unsorted = new Set(captureIds);
  const links = new Set(linkIds);
  const noteIds = new Set((ctx.notes ?? []).map((n) => n.id));
  const listByName = new Map(ctx.lists.map((l) => [norm(l.name), l.id]));
  const topicNames = new Set(ctx.topics.map((t) => norm(t.name)));
  const ideaByTitle = new Map(ctx.ideas.map((i) => [norm(i.title), i.id]));
  const items: PlannedItem[] = [];
  const newTopics = new Map<string, string>();
  const status = new Map<string, SortPlan['captures'][number]['status']>();
  const readingUpdates: ReadingUpdate[] = [];
  const facts: ProposedFact[] = [];
  const actions: PlannedAction[] = [];
  const seen = new Set<string>();
  const itemUpdates: ItemUpdate[] = [];
  const workshop: WorkshopRoute[] = [];
  const notesToWorkshop = new Set<string>();
  const followUps: PlannedFollowUp[] = [];

  /**
   * A planning task is due before the first occurrence of the event it came
   * with, or in 3 days (Task 12.1).
   */
  const duePlanning = (refs: (NewItemRef | undefined)[], planned: PlannedItem[]) => {
    const event = refs.find((x) => x?.type === 'event' && x.start_at);
    for (const p of planned)
      if (p.data.planning === true)
        p.due_at = planningDue(
          p.due_at,
          event?.start_at ?? null,
          ctx.now,
          ctx.timeZone ?? 'Europe/Dublin',
        );
  };

  /**
   * The questions for one result (Task 12.1): at most 3, about one of its own
   * items (or the first non-planning one). An answer may bring one more, about
   * the same item, and only up to MAX_ROUNDS (Task 12.2).
   */
  const ask = (
    r: SortAnswer['results'][number],
    refs: (NewItemRef | undefined)[],
    owner: { capture_id: string | null; note_id?: string },
    answer?: AnswerContext,
  ) => {
    const round = answer ? answer.round + 1 : 1;
    if (round > MAX_ROUNDS) return;
    const fallback =
      answer?.item?.id ??
      refs.find((x) => x && !(x as Partial<PlannedItem>).data?.planning)?.id ??
      refs.find((x) => x)?.id ??
      null;
    for (const f of cleanFollowUps(r.follow_ups, answer ? 1 : MAX_FOLLOW_UPS)) {
      // A further question stays in the thread: about the item first asked about.
      const ref = answer?.item ? answer.item : f.about_item >= 0 ? refs[f.about_item] : undefined;
      followUps.push({
        id: crypto.randomUUID(),
        ...owner,
        item_id: ref?.id ?? fallback,
        question: f.question,
        options: f.options,
        round,
      });
    }
  };

  /**
   * An answer is added to the details of the item it was about (Task 12.2),
   * as a tidy_item change the person can Undo.
   */
  const addAnswer = (captureId: string, answer: AnswerContext) => {
    const text = (ctx.texts?.get(captureId) ?? '').replace(/\s+/g, ' ').trim();
    if (!answer.item || !text) return;
    const line = `${answer.question} ${text}`;
    const body = [answer.item.body?.trim(), line].filter(Boolean).join('\n');
    itemUpdates.push({
      id: crypto.randomUUID(),
      capture_id: captureId,
      item_id: answer.item.id,
      summary: `Added your answer to “${answer.item.title}”`,
      quote: text.slice(0, 300),
      confidence: 1,
      before: { body: answer.item.body, updated_at: answer.item.updated_at },
      after: { body },
    });
  };

  /**
   * Keeps captured words as a Workshop note linked to the capture (Task 11.2):
   * the title from the words, the capture's text word for word in the body.
   */
  const toWorkshop = (captureId: string, words: string, reason: WorkshopRoute['reason']) => {
    const id = crypto.randomUUID();
    items.push({
      id,
      capture_id: captureId,
      type: 'note',
      title: workshopTitle(words),
      body: ctx.texts?.get(captureId) ?? words,
      status: 'open',
      start_at: null,
      end_at: null,
      all_day: false,
      due_at: null,
      rrule: null,
      calendar: null,
      list_id: null,
      topic_names: [],
      confidence: 1,
      data: { workshop: true, workshop_from: reason },
    });
    workshop.push({ capture_id: captureId, item_id: id, reason });
  };

  const noteTopics = (topics: string[]) => {
    for (const t of topics) if (!topicNames.has(norm(t))) newTopics.set(norm(t), t);
  };

  /** One item from the model, with Airhead's rules applied. */
  const toPlanned = (
    it: SortAnswerItem,
    captureId: string | null,
    isLink: boolean,
  ): PlannedItem => {
    const confidence = Math.min(1, Math.max(0, it.confidence));
    const data: Record<string, unknown> = {};
    // The words it came from, for the receipt (Task 12.3).
    const quote = (it.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (quote) data.quote = quote;
    // A planning task's checklist (Task 12.1): kept in data and shown in the body.
    const steps =
      it.type === 'task' && !isLink
        ? [...new Set((it.steps ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))]
            .map((s) => s.slice(0, 120))
            .slice(0, MAX_STEPS)
        : [];
    if (steps.length) {
      data.planning = true;
      data.steps = steps;
    }
    let itemStatus: PlannedItem['status'] = confidence < REVIEW_BELOW ? 'suggested' : 'open';
    let listId: string | null = null;

    const start = iso(it.start_at);
    if (it.type === 'event') {
      const future =
        start !== null && Date.parse(start) >= ctx.now.getTime() - (it.all_day ? 86_400_000 : 0);
      if (!future || confidence < EVENT_CONFIDENT) itemStatus = 'suggested';
    }
    if (it.type === 'list_entry') {
      listId = it.list_name ? (listByName.get(norm(it.list_name)) ?? null) : null;
      if (!listId) {
        itemStatus = 'suggested';
        if (it.list_name) data.proposed_list = it.list_name.trim();
      }
    }
    if (isLink) {
      // Untrusted content: never acted on automatically.
      itemStatus = 'suggested';
      data.from_link = true;
    }
    if (it.suggest_workshop) data.workshop = true;
    const ideaId = it.related_idea_title ? ideaByTitle.get(norm(it.related_idea_title)) : undefined;
    if (ideaId) data.related_idea_id = ideaId;

    const topics = cleanTopics(it.topics);
    noteTopics(topics);

    return {
      id: crypto.randomUUID(),
      capture_id: captureId,
      type: it.type,
      title: it.title.trim().replace(/\.$/, '') || '(untitled)',
      body: steps.length
        ? [it.body?.trim(), checklistBody(steps)].filter(Boolean).join('\n\n')
        : it.body?.trim() || null,
      status: itemStatus,
      start_at: start,
      end_at: iso(it.end_at),
      all_day: it.all_day,
      // A repeating task needs a first due time, or its reminder never fires.
      due_at:
        iso(it.due_at) ??
        (it.type === 'task' && it.rrule?.trim()
          ? firstDue(it.rrule, ctx.now, ctx.timeZone ?? 'Europe/Dublin')
          : null),
      rrule: it.rrule?.trim() || yearlyByNature(it.type, it.title),
      calendar: it.type === 'event' ? 'personal' : null,
      list_id: listId,
      topic_names: topics,
      confidence,
      data,
    };
  };

  const keepFacts = (r: SortAnswer['results'][number], captureId: string | null) => {
    for (const f of r.proposed_facts.slice(0, 3)) {
      const text = f.text.trim().slice(0, 200);
      if (text) facts.push({ text, category: f.category, source_capture_id: captureId });
    }
  };

  for (const r of result.results) {
    if (seen.has(r.capture_id)) continue;

    // A note the person wrote (Task 11.0): new items and actions only; the note stays as it is.
    if (r.capture_id.startsWith(NOTE_PREFIX)) {
      const noteId = r.capture_id.slice(NOTE_PREFIX.length);
      if (!noteIds.has(noteId)) continue;
      seen.add(r.capture_id);
      // Aligned with r.items, so target_item_index points at the right one.
      const refs: (NewItemRef | undefined)[] = [];
      for (const it of r.items) {
        if (it.type === 'note' || it.type === 'meeting') {
          refs.push(undefined); // the note itself already exists
          continue;
        }
        const planned = toPlanned(it, null, false);
        planned.note_id = noteId;
        planned.data.from_note_id = noteId;
        items.push(planned);
        refs.push(planned);
      }
      if (actx && (r.actions ?? []).length) {
        const planned = planActions(r.capture_id, r.actions.map(readAction), refs, actx);
        actions.push(
          ...planned.map((a) => ({
            ...a,
            capture_id: null,
            note_id: noteId,
            payload: { ...a.payload, note_id: noteId },
          })),
        );
      }
      duePlanning(
        refs,
        items.filter((p) => p.note_id === noteId),
      );
      ask(r, refs, { capture_id: null, note_id: noteId });
      keepFacts(r, null);
      // Words to plan that fit no item: the note itself goes to the Workshop (Task 11.2).
      if ((r.leftover ?? '').trim()) notesToWorkshop.add(noteId);
      continue;
    }

    const isLink = links.has(r.capture_id);
    if (!unsorted.has(r.capture_id) && !isLink) continue;
    seen.add(r.capture_id);
    const answer = isLink ? undefined : ctx.answers?.get(r.capture_id);
    // An answer is never unplaced: it is added to the item it was about (Task 12.2).
    const unmapped = r.items.length === 0 && (r.actions ?? []).length === 0 && !isLink && !answer;
    let review = unmapped;
    const instantRow = isLink ? undefined : ctx.instant?.get(r.capture_id);
    let tidyDone = false;
    let tidy: ItemUpdate | null = null;
    /** This capture's items in the model's order (a reminder's target_item_index counts these). */
    const refs: (NewItemRef | undefined)[] = [];
    let instantRef: NewItemRef | undefined;

    for (const it of r.items) {
      if (isLink && it.type === 'reading') {
        refs.push(undefined); // the reading item already exists
        continue;
      }
      const planned = toPlanned(it, r.capture_id, isLink);

      // The first event of a longer note is the instant event, tidied (Task 11.1).
      if (instantRow && !tidyDone && it.type === 'event') {
        tidyDone = true;
        if (instantRow.deleted_at) {
          refs.push(undefined); // the person removed it: do not bring it back
          continue;
        }
        const after = tidyOf(instantRow, planned);
        if (((after.status as string | undefined) ?? instantRow.status) === 'suggested')
          review = true;
        // A reminder on this event points at the existing item, not a new one.
        instantRef = {
          id: instantRow.id,
          type: 'event',
          start_at: planned.start_at ?? instantRow.start_at,
          all_day: planned.all_day,
          due_at: null,
          data: { ...(instantRow.data ?? {}) },
        };
        refs.push(instantRef);
        if (Object.keys(after).length) {
          tidy = {
            id: crypto.randomUUID(),
            capture_id: r.capture_id,
            item_id: instantRow.id,
            summary: '',
            quote: instantRow.title,
            confidence: planned.confidence,
            before: {
              ...Object.fromEntries(
                Object.keys(after).map((k) => [k, instantRow[k as keyof InstantRow]]),
              ),
              updated_at: instantRow.updated_at,
            },
            after,
          };
        }
        continue;
      }

      if (planned.status === 'suggested' && !isLink) review = true;
      items.push(planned);
      refs.push(planned);
    }

    duePlanning(
      refs,
      items.filter((p) => p.capture_id === r.capture_id),
    );

    if (tidy) {
      const added = items.filter((p) => p.capture_id === r.capture_id).length;
      const title = (tidy.after.title as string | undefined) ?? instantRow?.title ?? '';
      tidy.summary =
        `Tidied “${title}”` + (added ? ` and added ${added} item${added === 1 ? '' : 's'}` : '');
      itemUpdates.push(tidy);
    }

    if (isLink) {
      if (r.link_summary) {
        const topics = cleanTopics(r.link_summary.topics);
        noteTopics(topics);
        readingUpdates.push({
          capture_id: r.capture_id,
          summary: r.link_summary.summary.trim(),
          key_points: r.link_summary.key_points
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 5),
          topic_names: topics,
        });
      }
    } else {
      // Actions only ever come from what the person typed (never from page text).
      if (actx && (r.actions ?? []).length) {
        const planned = planActions(r.capture_id, r.actions.map(readAction), refs, actx);
        if (instantRow && instantRef) {
          for (const a of planned) {
            if (a.status !== 'applied' || a.target_table !== 'items') continue;
            if (a.target_id !== instantRow.id) continue;
            if (tidy) {
              // Applied with the tidy-up (one freshness check), so Undo restores both.
              tidy.after.data = a.after?.data;
              tidy.before.data = instantRow.data ?? {};
            } else {
              // No tidy-up: an ordinary change to an existing item, checked for freshness.
              a.before = { ...(a.before ?? {}), updated_at: instantRow.updated_at };
            }
          }
        }
        actions.push(...planned);
        if (planned.some((p) => p.status === 'proposed')) review = true;
      }
      // Nothing silently dropped (Task 11.2): an unplaced capture, or the words
      // no item covers, are kept as a Workshop note.
      const text = (ctx.texts?.get(r.capture_id) ?? '').trim();
      const leftover = (r.leftover ?? '').trim();
      if (answer) {
        addAnswer(r.capture_id, answer);
      } else if (unmapped && text) {
        toWorkshop(r.capture_id, text, 'unmapped');
        review = false;
      } else if (
        leftover &&
        !items.some((p) => p.capture_id === r.capture_id && norm(p.title) === norm(leftover))
      ) {
        toWorkshop(r.capture_id, leftover, 'leftover');
      }
      ask(r, refs, { capture_id: r.capture_id }, answer);
      status.set(r.capture_id, review ? 'needs_review' : 'sorted');
      // Facts are learned only from what the person typed, never from page text.
      keepFacts(r, r.capture_id);
    }
  }

  // The batch's digest becomes an everyday fact, so later batches see it (Task 11.0).
  const digest = (result.digest ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (digest && !facts.some((f) => norm(f.text) === norm(digest)))
    facts.push({ text: digest, category: 'everyday', source_capture_id: null, source: 'digest' });

  // A capture the model skipped altogether is kept in the Workshop too.
  for (const id of captureIds) {
    const text = (ctx.texts?.get(id) ?? '').trim();
    if (status.has(id) || !text) continue;
    const answer = ctx.answers?.get(id);
    if (answer) addAnswer(id, answer);
    else toWorkshop(id, text, 'unmapped');
    status.set(id, 'sorted');
  }

  return {
    items,
    captures: captureIds.map((id) => ({ id, status: status.get(id) ?? 'failed' })),
    new_topics: [...newTopics.values()],
    reading_updates: readingUpdates,
    link_captures: linkIds,
    facts,
    actions,
    item_updates: itemUpdates,
    notes: (ctx.notes ?? []).map((n) =>
      notesToWorkshop.has(n.id) ? { ...n, workshop: true as const } : n,
    ),
    workshop,
    follow_ups: followUps,
  };
}
