import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { Candidate, FactIn } from './review.ts';
import type { ReviewStore } from './run.ts';

const DAY = 86_400_000;

/** The review's database access, with the service key (always filtered to one person). */
export function supabaseReviewStore(db: SupabaseClient): ReviewStore {
  return {
    async digest(userId, weekStart) {
      const { data, error } = await db.rpc('weekly_digest', {
        p_user_id: userId,
        p_week_start: weekStart,
      });
      if (error) throw new Error(`digest: ${error.message}`);
      return data as Record<string, unknown>;
    },
    async pastDigests(userId, before, n) {
      const { data } = await db
        .from('reviews')
        .select('week_start, digest')
        .eq('user_id', userId)
        .lt('week_start', before)
        .is('deleted_at', null)
        .order('week_start', { ascending: false })
        .limit(n);
      return (data ?? []).filter((r) => r.digest) as { week_start: string; digest: string }[];
    },
    async candidates(userId) {
      const { data, error } = await db.rpc('tidy_candidates', { p_user_id: userId });
      if (error) throw new Error(`candidates: ${error.message}`);
      return (data ?? []) as Candidate[];
    },
    async facts(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('id, text, last_used_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('last_used_at', { ascending: true, nullsFirst: true })
        .limit(40);
      const now = Date.now();
      return (data ?? []).map((f) => ({
        id: f.id as string,
        text: f.text as string,
        unused_days: Math.floor(
          (now - new Date((f.last_used_at ?? f.created_at) as string).getTime()) / DAY,
        ),
      })) as FactIn[];
    },
    async softDelete(userId, kind, ids) {
      await db
        .from(kind === 'item' ? 'items' : 'captures')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('id', ids)
        .is('deleted_at', null);
    },
    async saveReview(userId, weekStart, r) {
      const { error } = await db.from('reviews').upsert(
        {
          user_id: userId,
          week_start: weekStart,
          status: r.status,
          content: r.content,
          digest: r.digest,
          cost_eur: r.cost_eur,
          deleted_at: null,
        },
        { onConflict: 'user_id,week_start' },
      );
      if (error) throw new Error(`save review: ${error.message}`);
    },
    async addNudge(userId, n) {
      await db.from('nudges').upsert(
        {
          user_id: userId,
          kind: 'weekly_review',
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
