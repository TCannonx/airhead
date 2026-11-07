import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { buildProfile, type FactRow } from '../_shared/memory.ts';
import type { Digest } from './brief.ts';
import type { BriefStore } from './run.ts';

/** The brief's database access, with the service key (always filtered to one person). */
export function supabaseBriefStore(db: SupabaseClient): BriefStore {
  return {
    async digest(userId, localDate) {
      const { data, error } = await db.rpc('morning_digest', {
        p_user_id: userId,
        p_local_date: localDate,
      });
      if (error) throw new Error(`digest: ${error.message}`);
      return data as Digest;
    },
    async settings(userId) {
      const { data } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
      return (data?.data ?? {}) as Record<string, unknown>;
    },
    async profile(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('id, text, last_used_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);
      return buildProfile((data ?? []) as FactRow[]).text;
    },
    async recentWeeks(userId, n) {
      const { data } = await db
        .from('reviews')
        .select('week_start, digest')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .not('digest', 'is', null)
        .order('week_start', { ascending: false })
        .limit(n);
      return (data ?? []) as { week_start: string; digest: string }[];
    },
    async saveBrief(userId, localDate, b) {
      const { error } = await db.from('briefs').upsert(
        {
          user_id: userId,
          local_date: localDate,
          status: b.status,
          content: b.content,
          model: b.model,
          cost_eur: b.cost_eur,
          deleted_at: null,
        },
        { onConflict: 'user_id,local_date' },
      );
      if (error) throw new Error(`save brief: ${error.message}`);
    },
    async setTop3(userId, ids, localDate) {
      if (ids.length)
        await db.from('items').update({ top3_date: localDate }).eq('user_id', userId).in('id', ids);
    },
    async cancelPrep(userId, localDate) {
      await db
        .from('nudges')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('kind', 'prep')
        .eq('status', 'pending')
        .like('dedupe_key', `prep:${localDate}:%`);
    },
    async addNudge(userId, n) {
      await db
        .from('nudges')
        .upsert(
          { user_id: userId, ...n },
          { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
        );
    },
  };
}
