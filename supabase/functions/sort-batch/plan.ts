import type { SortedItemT, SortResultT } from '../_shared/schemas/sort.ts';
import { type ActionContext, type PlannedAction, planActions } from './actions.ts';

/** An event is created straight away only from this confidence up (otherwise a suggestion). */
export const EVENT_CONFIDENT = 0.8;
/** Below this, the item is a one-tap choice and the capture needs review. */
export const REVIEW_BELOW = 0.6;

export interface PlanContext {
  now: Date;
  topics: { id: string; name: string }[];
  lists: { id: string; name: string }[];
  ideas: { id: string; title: string }[];
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
}

const norm = (s: string) => s.trim().toLowerCase();
const cleanTopics = (topics: string[]) =>
  [...new Set(topics.map((t) => t.trim()).filter(Boolean))].slice(0, 3);

function iso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
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

  const noteTopics = (topics: string[]) => {
    for (const t of topics) if (!topicNames.has(norm(t))) newTopics.set(norm(t), t);
  };

  for (const r of result.results) {
    const isLink = links.has(r.capture_id);
    if ((!unsorted.has(r.capture_id) && !isLink) || seen.has(r.capture_id)) continue;
    seen.add(r.capture_id);
    let review = r.items.length === 0 && (r.actions ?? []).length === 0 && !isLink;

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

      if (itemStatus === 'suggested' && !isLink) review = true;
      items.push({
        id: crypto.randomUUID(),
        capture_id: r.capture_id,
        type: it.type,
        title: it.title.trim().replace(/\.$/, '') || '(untitled)',
        body: it.body?.trim() || null,
        status: itemStatus,
        start_at: start,
        end_at: iso(it.end_at),
        all_day: it.all_day,
        due_at: iso(it.due_at),
        rrule: it.rrule?.trim() || null,
        calendar: it.type === 'event' ? 'personal' : null,
        list_id: listId,
        topic_names: topics,
        confidence,
        data,
      });
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
        const planned = planActions(r.capture_id, r.actions, mine, actx);
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
  };
}
