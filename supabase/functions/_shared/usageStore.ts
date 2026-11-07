import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { UsageStore } from './ai.ts';
import type { Price } from './prices.ts';

/** UsageStore backed by the database (service-role client: bypasses RLS). */
export function supabaseUsageStore(db: SupabaseClient): UsageStore {
  return {
    async price(userId, model) {
      // The user's own price row wins over the default (user_id null).
      const { data, error } = await db
        .from('ai_prices')
        .select(
          'model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, eur_rate, user_id',
        )
        .eq('model', model)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .order('user_id', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`price lookup failed: ${error.message}`);
      if (!data) throw new Error(`no price configured for ${model}`);
      return data as Price;
    },

    async monthlyCapEur(userId) {
      const { data } = await db.from('settings').select('data').eq('user_id', userId).maybeSingle();
      const cap = (data?.data as { ai_monthly_cap_eur?: unknown } | undefined)?.ai_monthly_cap_eur;
      return typeof cap === 'number' && cap > 0 ? cap : null;
    },

    async monthToDateEur(userId) {
      const { data, error } = await db.rpc('ai_month_to_date_eur', { p_user_id: userId });
      if (error) throw new Error(`spend lookup failed: ${error.message}`);
      return Number(data ?? 0);
    },

    async record(row) {
      const { error } = await db.from('ai_usage').insert(row);
      if (error) console.error('ai_usage insert failed', error.message);
    },
  };
}
