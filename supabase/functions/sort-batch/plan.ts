import { readAction, type SortedItemT, type SortResultT } from '../_shared/schemas/sort.ts';
import { type ActionContext, type PlannedAction, planActions } from './actions.ts';

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
  capture_id: string;
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
  source_capture_id: string;
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
}

const norm = (s: string) => s.trim().toLowerCase();
const cleanTopics = (topics: string[]) =>
  [...new Set(topics.map((t) => t.trim()).filter(Boolean))].slice(0, 3);

/** 09:00 tomorrow in the time zone, as UTC ISO: the first reminder of a repeat with no date. */
export function tomorrowMorning(now: Date, timeZone: string): string {
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
  const day = local(new Date(now.getTime() + 86_400_000)).slice(0, 10);
  // Start from 09:00 UTC that day and correct by the zone's offset at that time.
  const guess = Date.parse(`${day}T09:00:00Z`);
  const offsetMs = Date.parse(`${local(new Date(guess))}:00Z`) - guess;
  return new Date(guess - offsetMs).toISOString();
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
  result: SortResultT,
  ctx: PlanContext,
  linkIds: string[] = [],
  actx?: ActionContext,
): SortPlan {
  const unsorted = new Set(captureIds);
  const links = new Set(linkIds);
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

  const noteTopics = (topics: string[]) => {
    for (const t of topics) if (!topicNames.has(norm(t))) newTopics.set(norm(t), t);
  };

  for (const r of result.results) {
    const isLink = links.has(r.capture_id);
    if ((!unsorted.has(r.capture_id) && !isLink) || seen.has(r.capture_id)) continue;
    seen.add(r.capture_id);
    let review = r.items.length === 0 && (r.actions ?? []).length === 0 && !isLink;
    const instantRow = isLink ? undefined : ctx.instant?.get(r.capture_id);
    let tidyDone = false;
    let tidy: ItemUpdate | null = null;

    for (const it of r.items) {
      if (isLink && it.type === 'reading') continue; // the reading item already exists
      const confidence = Math.min(1, Math.max(0, it.confidence));
      const data: Record<string, unknown> = {};
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
      const ideaId = it.related_idea_title
        ? ideaByTitle.get(norm(it.related_idea_title))
        : undefined;
      if (ideaId) data.related_idea_id = ideaId;

      const topics = cleanTopics(it.topics);
      noteTopics(topics);

      const planned: PlannedItem = {
        id: crypto.randomUUID(),
        capture_id: r.capture_id,
        type: it.type,
        title: it.title.trim().replace(/\.$/, '') || '(untitled)',
        body: it.body?.trim() || null,
        status: itemStatus,
        start_at: start,
        end_at: iso(it.end_at),
        all_day: it.all_day,
        // A repeating task needs a first due time, or its reminder never fires.
        due_at:
          iso(it.due_at) ??
          (it.type === 'task' && it.rrule?.trim()
            ? tomorrowMorning(ctx.now, ctx.timeZone ?? 'Europe/Dublin')
            : null),
        rrule: it.rrule?.trim() || null,
        calendar: it.type === 'event' ? 'personal' : null,
        list_id: listId,
        topic_names: topics,
        confidence,
        data,
      };

      // The first event of a longer note is the instant event, tidied (Task 11.1).
      if (instantRow && !tidyDone && it.type === 'event') {
        tidyDone = true;
        if (instantRow.deleted_at) continue; // the person removed it: do not bring it back
        const after = tidyOf(instantRow, planned);
        if (((after.status as string | undefined) ?? instantRow.status) === 'suggested')
          review = true;
        if (Object.keys(after).length) {
          tidy = {
            id: crypto.randomUUID(),
            capture_id: r.capture_id,
            item_id: instantRow.id,
            summary: '',
            quote: instantRow.title,
            confidence,
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

      if (itemStatus === 'suggested' && !isLink) review = true;
      items.push(planned);
    }

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
        const mine = items.filter((p) => p.capture_id === r.capture_id);
        const planned = planActions(r.capture_id, r.actions.map(readAction), mine, actx);
        actions.push(...planned);
        if (planned.some((p) => p.status === 'proposed')) review = true;
      }
      status.set(r.capture_id, review ? 'needs_review' : 'sorted');
      // Facts are learned only from what the person typed, never from page text.
      for (const f of r.proposed_facts.slice(0, 3)) {
        const text = f.text.trim().slice(0, 200);
        if (text) facts.push({ text, category: f.category, source_capture_id: r.capture_id });
      }
    }
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
  };
}
