import type { SortedItemT, SortResultT } from '../_shared/schemas/sort.ts';

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

export interface SortPlan {
  items: PlannedItem[];
  captures: { id: string; status: 'sorted' | 'needs_review' | 'failed' }[];
  /** Topic names to create (not already existing, case-insensitive). */
  new_topics: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

function iso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Turns the model's answer into rows, applying Airhead's own rules (the model
 * suggests, the rules decide): confident future events are created, anything
 * unsure becomes a suggestion, unknown lists ask first, topics are reused.
 */
export function planSort(captureIds: string[], result: SortResultT, ctx: PlanContext): SortPlan {
  const inBatch = new Set(captureIds);
  const listByName = new Map(ctx.lists.map((l) => [norm(l.name), l.id]));
  const topicNames = new Set(ctx.topics.map((t) => norm(t.name)));
  const ideaByTitle = new Map(ctx.ideas.map((i) => [norm(i.title), i.id]));
  const items: PlannedItem[] = [];
  const newTopics = new Map<string, string>();
  const status = new Map<string, SortPlan['captures'][number]['status']>();

  for (const r of result.results) {
    if (!inBatch.has(r.capture_id) || status.has(r.capture_id)) continue;
    let review = r.items.length === 0;

    for (const it of r.items) {
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
      if (it.suggest_workshop) data.workshop = true;
      const ideaId = it.related_idea_title
        ? ideaByTitle.get(norm(it.related_idea_title))
        : undefined;
      if (ideaId) data.related_idea_id = ideaId;

      const topics = [...new Set(it.topics.map((t) => t.trim()).filter(Boolean))].slice(0, 3);
      for (const t of topics) if (!topicNames.has(norm(t))) newTopics.set(norm(t), t);

      if (itemStatus === 'suggested') review = true;
      items.push({
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
    status.set(r.capture_id, review ? 'needs_review' : 'sorted');
  }

  return {
    items,
    captures: captureIds.map((id) => ({ id, status: status.get(id) ?? 'failed' })),
    new_topics: [...newTopics.values()],
  };
}
