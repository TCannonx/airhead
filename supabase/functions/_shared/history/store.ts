import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { HistoryItem, HistoryStore } from './lookups.ts';

const ITEM_COLS = 'id, type, title, body, start_at, due_at, created_at, series_id, rrule';
const ZERO = JSON.stringify(Array.from({ length: 384 }, () => 0));

/**
 * The look-ups' database access with the service key (Task 14.6). Every query is
 * filtered to the one person. `embed` is the Edge runtime's gte-small model when
 * available; without it the search is keyword-only.
 */
export function supabaseHistoryStore(
  db: SupabaseClient,
  embed: (text: string) => Promise<number[] | null> = async () => null,
): HistoryStore {
  return {
    embed,
    async search(userId, query, embedding, count) {
      const { data, error } = await db.rpc('hybrid_search_for', {
        p_user_id: userId,
        query_text: query,
        query_embedding: embedding ? JSON.stringify(embedding) : ZERO,
        match_count: count,
        semantic_weight: embedding ? 1 : 0,
      });
      if (error) throw new Error(`search: ${error.message}`);
      return ((data ?? []) as { item_id: string }[]).map((r) => r.item_id);
    },
    async items(userId, ids) {
      if (!ids.length) return [];
      const { data } = await db
        .from('items')
        .select(ITEM_COLS)
        .eq('user_id', userId)
        .in('id', ids)
        .is('deleted_at', null);
      return (data ?? []) as HistoryItem[];
    },
    async page(userId, kind, key, name) {
      const cols = 'id, kind, name, summary, facts';
      const { data } = await db
        .from('pages')
        .select(cols)
        .eq('user_id', userId)
        .eq('key', key)
        .is('deleted_at', null)
        .maybeSingle();
      if (data) return data as never;
      // Pages keyed by id (series, topics) are found by name.
      const { data: byName } = await db
        .from('pages')
        .select(cols)
        .eq('user_id', userId)
        .eq('kind', kind)
        .ilike('name', name.replace(/[%_]/g, ''))
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      return (byName as never) ?? null;
    },
    async pageItems(pageId, limit) {
      const { data: links } = await db
        .from('page_items')
        .select('item_id')
        .eq('page_id', pageId)
        .is('deleted_at', null)
        .limit(500);
      const ids = (links ?? []).map((l) => l.item_id as string);
      if (!ids.length) return [];
      const { data } = await db
        .from('items')
        .select(ITEM_COLS)
        .in('id', ids)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      return (data ?? []) as HistoryItem[];
    },
    async seriesBefore(userId, seriesId, before, n) {
      const { data } = await db
        .from('items')
        .select(ITEM_COLS)
        .eq('user_id', userId)
        .eq('series_id', seriesId)
        .lt('start_at', before)
        .is('deleted_at', null)
        .order('start_at', { ascending: false })
        .limit(n);
      return (data ?? []) as HistoryItem[];
    },
    async eventsLike(userId, title, before, n, excludeId) {
      const words = title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4)
        .slice(0, 4);
      if (!words.length) return [];
      const { data } = await db
        .from('items')
        .select(ITEM_COLS)
        .eq('user_id', userId)
        .eq('type', 'event')
        .neq('id', excludeId)
        .lt('start_at', before)
        .is('deleted_at', null)
        .or(words.map((w) => `title.ilike.%${w}%`).join(','))
        .order('start_at', { ascending: false })
        .limit(n);
      return (data ?? []) as HistoryItem[];
    },
    async planned(ids) {
      const out = new Map<
        string,
        { prep: string[]; nudges: { kind: string; at: string; outcome: string | null }[] }
      >();
      if (!ids.length) return out;
      const [{ data: plans }, { data: nudges }] = await Promise.all([
        db.from('item_plans').select('item_id, prep').in('item_id', ids),
        db
          .from('nudges')
          .select('item_id, kind, send_at, outcome')
          .in('item_id', ids)
          .in('kind', ['prepare', 'leave', 'do', 'follow_up', 'reading'])
          .order('send_at'),
      ]);
      for (const id of ids) out.set(id, { prep: [], nudges: [] });
      for (const p of plans ?? [])
        out.get(p.item_id as string)!.prep = Array.isArray(p.prep) ? (p.prep as string[]) : [];
      for (const n of nudges ?? [])
        out.get(n.item_id as string)?.nudges.push({
          kind: n.kind as string,
          at: n.send_at as string,
          outcome: (n.outcome as string | null) ?? null,
        });
      return out;
    },
  };
}
