/**
 * History look-ups the planner can call (Task 14.6, spec §5). Each returns
 * compact rows (id, type, date, title, one line) so a look-up costs few tokens.
 * The store is a fake in tests and Supabase (service key, one person) in production.
 */

export interface HistoryItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  start_at: string | null;
  due_at: string | null;
  created_at: string;
  series_id: string | null;
  rrule: string | null;
}

export interface CompactRow {
  id: string;
  type: string;
  date: string | null;
  title: string;
  line: string;
}

export interface HistoryStore {
  /** Query embedding (gte-small); null when the model is not available. */
  embed(text: string): Promise<number[] | null>;
  /** hybrid_search_for: item ids, best first. */
  search(
    userId: string,
    query: string,
    embedding: number[] | null,
    count: number,
  ): Promise<string[]>;
  items(userId: string, ids: string[]): Promise<HistoryItem[]>;
  page(
    userId: string,
    kind: string,
    key: string,
    name: string,
  ): Promise<{ id: string; kind: string; name: string; summary: string; facts: unknown[] } | null>;
  /** The page's items, most recent first. */
  pageItems(pageId: string, limit: number): Promise<HistoryItem[]>;
  /** Earlier items in the same series (series_id), most recent first. */
  seriesBefore(userId: string, seriesId: string, before: string, n: number): Promise<HistoryItem[]>;
  /** Earlier events whose title shares a word with `title`, most recent first. */
  eventsLike(
    userId: string,
    title: string,
    before: string,
    n: number,
    excludeId: string,
  ): Promise<HistoryItem[]>;
  /** item_plans.prep and the nudges (kind, send time, outcome) for these items. */
  planned(
    ids: string[],
  ): Promise<
    Map<string, { prep: string[]; nudges: { kind: string; at: string; outcome: string | null }[] }>
  >;
}

export const DEFAULT_LIMIT = 8;
const LINE = 140;

const dateOf = (i: HistoryItem) => (i.start_at ?? i.due_at ?? i.created_at)?.slice(0, 10) ?? null;

export function compact(i: HistoryItem): CompactRow {
  return {
    id: i.id,
    type: i.type,
    date: dateOf(i),
    title: i.title.slice(0, 120),
    line: (i.body ?? '').replace(/\s+/g, ' ').trim().slice(0, LINE),
  };
}

/** "Niamh  O'Brien" → "niamh o'brien", as public.page_name_key. */
export const pageNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** search_history(query, from?, to?, types?): hybrid search over the person's items. */
export async function searchHistory(
  store: HistoryStore,
  userId: string,
  query: string,
  opts: { from?: string; to?: string; types?: string[]; limit?: number } = {},
): Promise<CompactRow[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 20);
  const embedding = await store.embed(q).catch(() => null);
  const ids = [...new Set(await store.search(userId, q, embedding, limit * 3))];
  if (!ids.length) return [];
  const byId = new Map((await store.items(userId, ids)).map((i) => [i.id, i]));
  const out: CompactRow[] = [];
  for (const id of ids) {
    const i = byId.get(id);
    if (!i) continue;
    const d = dateOf(i);
    if (opts.from && (!d || d < opts.from)) continue;
    if (opts.to && (!d || d > opts.to)) continue;
    if (opts.types?.length && !opts.types.includes(i.type)) continue;
    out.push(compact(i));
    if (out.length >= limit) break;
  }
  return out;
}

/** get_page(kind, name): the page summary, facts and its 8 most recent items. */
export async function getPage(store: HistoryStore, userId: string, kind: string, name: string) {
  const key = `${kind}:${pageNameKey(name)}`;
  const page = await store.page(userId, kind, key, name.trim());
  if (!page) return null;
  const items = await store.pageItems(page.id, DEFAULT_LIMIT);
  return {
    kind: page.kind,
    name: page.name,
    summary: page.summary,
    facts: page.facts,
    items: items.map(compact),
  };
}

/**
 * previous_occurrences(item_id, n): earlier occurrences of the same series, else
 * the closest earlier events by title, each with what was prepared and the
 * reminders it had and what the owner did with them.
 */
export async function previousOccurrences(
  store: HistoryStore,
  userId: string,
  itemId: string,
  n = 3,
): Promise<
  (CompactRow & {
    prep: string[];
    nudges: { kind: string; at: string; outcome: string | null }[];
  })[]
> {
  const count = Math.min(Math.max(n, 1), 10);
  const [item] = await store.items(userId, [itemId]);
  if (!item) return [];
  const before = item.start_at ?? item.due_at ?? new Date().toISOString();
  let earlier = item.series_id
    ? await store.seriesBefore(userId, item.series_id, before, count)
    : [];
  if (!earlier.length) earlier = await store.eventsLike(userId, item.title, before, count, item.id);
  const plans = await store.planned(earlier.map((e) => e.id));
  return earlier.slice(0, count).map((e) => ({
    ...compact(e),
    prep: plans.get(e.id)?.prep ?? [],
    nudges: plans.get(e.id)?.nudges ?? [],
  }));
}
