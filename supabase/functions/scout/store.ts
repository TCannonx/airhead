import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { ItemRow } from './findings.ts';
import type { FactIn } from './queries.ts';
import type { ScoutStore } from './run.ts';

const DAY = 86_400_000;

/** Scout's database access, with the service key (always filtered to one person). */
export function supabaseScoutStore(db: SupabaseClient): ScoutStore {
  return {
    async settings(userId) {
      const { data } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
      return (data?.data ?? {}) as Record<string, unknown>;
    },
    async facts(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('text, category')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);
      return (data ?? []) as FactIn[];
    },
    async items(userId) {
      const { data } = await db
        .from('items')
        .select('id, type, title, status, data, start_at, due_at, rrule, created_at, updated_at')
        .eq('user_id', userId)
        .in('type', ['meeting', 'event', 'task', 'idea'])
        .eq('status', 'open')
        .is('deleted_at', null)
        .limit(2000);
      return (data ?? []) as ItemRow[];
    },
    async followedUp(userId) {
      const since = new Date(Date.now() - 30 * DAY).toISOString();
      const [{ data: tasks }, { data: drafts }] = await Promise.all([
        db
          .from('items')
          .select('data')
          .eq('user_id', userId)
          .eq('type', 'task')
          .is('deleted_at', null)
          .or('data->>note_id.not.is.null,data->>idea_id.not.is.null'),
        db.from('drafts').select('item_id').eq('user_id', userId).gte('created_at', since),
      ]);
      const out = new Set<string>();
      for (const t of tasks ?? []) {
        const d = (t.data ?? {}) as Record<string, unknown>;
        for (const k of ['note_id', 'idea_id'])
          if (typeof d[k] === 'string') out.add(d[k] as string);
      }
      for (const d of drafts ?? []) out.add(d.item_id as string);
      return out;
    },
    async linkedStarts(userId) {
      const now = new Date();
      const { data } = await db
        .from('external_events')
        .select('start_at')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('start_at', now.toISOString())
        .lte('start_at', new Date(now.getTime() + 15 * DAY).toISOString());
      return (data ?? []).map((e) => e.start_at as string);
    },
    async openTitles(userId) {
      const { data } = await db
        .from('suggestions')
        .select('title')
        .eq('user_id', userId)
        .eq('status', 'open')
        .is('deleted_at', null);
      return new Set((data ?? []).map((s) => s.title as string));
    },
    async saveRun(userId, run) {
      const { data, error } = await db
        .from('scout_runs')
        .insert({ user_id: userId, ...run })
        .select('id')
        .single();
      if (error) throw new Error(`save run: ${error.message}`);
      return data.id as string;
    },
    async saveCards(userId, runId, cards) {
      const { error } = await db
        .from('suggestions')
        .insert(cards.map((c) => ({ user_id: userId, run_id: runId, status: 'open', ...c })));
      if (error) throw new Error(`save cards: ${error.message}`);
    },
    async addNudge(userId, n) {
      await db.from('nudges').upsert(
        {
          user_id: userId,
          kind: 'scout',
          item_id: null,
          send_at: new Date().toISOString(),
          title: n.title,
          body: n.body,
          url: n.url,
          dedupe_key: n.dedupe_key,
        },
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
      );
    },
  };
}
