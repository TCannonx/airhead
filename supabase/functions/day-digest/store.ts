import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { DayDigestStore, DaySource } from './run.ts';

/** Day summaries' database access, with the service key (always one person). */
export function supabaseDayDigestStore(db: SupabaseClient): DayDigestStore {
  return {
    async datesToBuild(userId, yesterday) {
      const { data: have } = await db
        .from('day_digests')
        .select('local_date')
        .eq('user_id', userId)
        .eq('local_date', yesterday)
        .maybeSingle();
      const { data: stale } = await db
        .from('day_digests')
        .select('local_date')
        .eq('user_id', userId)
        .eq('stale', true)
        .order('local_date', { ascending: false })
        .limit(10);
      return [...(have ? [] : [yesterday]), ...(stale ?? []).map((r) => r.local_date as string)];
    },
    async source(userId, localDate) {
      const { data, error } = await db.rpc('day_digest_source', {
        p_user_id: userId,
        p_local_date: localDate,
      });
      if (error) throw new Error(`day source: ${error.message}`);
      return data as DaySource;
    },
    async save(userId, localDate, row) {
      const { error } = await db.from('day_digests').upsert(
        {
          user_id: userId,
          local_date: localDate,
          digest: row.digest,
          item_ids: row.item_ids,
          stale: false,
          built_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: 'user_id,local_date' },
      );
      if (error) throw new Error(`save day digest: ${error.message}`);
    },
  };
}
