import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { PageItemLine, PageRow, PageSummaryStore } from './run.ts';

/** Page summaries' database access, with the service key (always one person). */
export function supabasePageSummaryStore(db: SupabaseClient, userId: string): PageSummaryStore {
  return {
    async due(_userId, limit) {
      const { data, error } = await db.rpc('pages_to_summarise', {
        p_user_id: userId,
        p_limit: limit,
      });
      if (error) throw new Error(`pages due: ${error.message}`);
      return (data ?? []) as PageRow[];
    },
    async items(pageId, since) {
      const { data: links } = await db
        .from('page_items')
        .select('item_id')
        .eq('page_id', pageId)
        .is('deleted_at', null)
        .limit(500);
      const ids = (links ?? []).map((l) => l.item_id as string);
      if (!ids.length) return [];
      let q = db
        .from('items')
        .select('id, type, title, body, data, start_at, due_at, created_at, updated_at')
        .in('id', ids)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(40);
      if (since) q = q.gt('updated_at', since);
      const { data } = await q;
      return (data ?? []).map((i): PageItemLine => ({
        id: i.id as string,
        type: i.type as string,
        date: ((i.start_at ?? i.due_at ?? i.created_at) as string | null)?.slice(0, 10) ?? null,
        title: String(i.title ?? '').slice(0, 120),
        // A saved link is described by its enrichment (Task 16.2).
        line: String(
          ((i.data as { link?: { summary?: string } } | null)?.link?.summary ?? i.body) || '',
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200),
      }));
    },
    async readingCount(pageId) {
      const { data } = await db.rpc('page_reading_count', { p_page_id: pageId });
      return Number(data ?? 0);
    },
    async saveTopic(pageId, row) {
      const now = new Date().toISOString();
      const { error } = await db
        .from('pages')
        .update({
          summary: row.summary,
          collation: row.collation,
          summary_stale: false,
          summarised_at: now,
          rebuild_requested_at: null,
          updated_at: now,
        })
        .eq('id', pageId)
        .eq('user_id', userId);
      if (error) throw new Error(`save topic: ${error.message}`);
      for (const n of row.notes) {
        await db
          .from('page_items')
          .update({ note: n.note, updated_at: now })
          .eq('page_id', pageId)
          .eq('item_id', n.item_id);
      }
    },
    async save(pageId, row) {
      const { error } = await db
        .from('pages')
        .update({
          summary: row.summary,
          facts: row.facts,
          summary_stale: false,
          summarised_at: new Date().toISOString(),
          rebuild_requested_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pageId)
        .eq('user_id', userId);
      if (error) throw new Error(`save page: ${error.message}`);
    },
  };
}
