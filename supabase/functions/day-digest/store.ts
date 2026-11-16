import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { MonthDigestStore } from './month.ts';
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

/** Month summaries' database access, with the service key (always one person). */
export function supabaseMonthDigestStore(db: SupabaseClient): MonthDigestStore {
  return {
    async monthsToBuild(userId, lastMonth) {
      const { data: have } = await db
        .from('month_digests')
        .select('month')
        .eq('user_id', userId)
        .eq('month', lastMonth)
        .maybeSingle();
      const { data: stale } = await db
        .from('month_digests')
        .select('month')
        .eq('user_id', userId)
        .eq('stale', true)
        .order('month', { ascending: false })
        .limit(3);
      return [...(have ? [] : [lastMonth]), ...(stale ?? []).map((r) => r.month as string)];
    },
    async weeks(userId, month) {
      const end = new Date(`${month}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const { data } = await db
        .from('reviews')
        .select('week_start, digest')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('week_start', month)
        .lt('week_start', end.toISOString().slice(0, 10))
        .order('week_start');
      return (data ?? []).map((r) => ({
        week_start: r.week_start as string,
        digest: (r.digest as string | null) ?? '',
      }));
    },
    async save(userId, month, row) {
      const { error } = await db.from('month_digests').upsert(
        {
          user_id: userId,
          month,
          digest: row.digest,
          week_starts: row.week_starts,
          stale: false,
          built_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: 'user_id,month' },
      );
      if (error) throw new Error(`save month digest: ${error.message}`);
    },
  };
}
