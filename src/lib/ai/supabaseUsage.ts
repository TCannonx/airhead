import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsageService } from '../auth/types';
import type { PriceRow, UsageRow } from './usage';

/** Reads the user's AI usage (ai_usage_mine view) and prices; saves price overrides. */
export function supabaseUsage(supabase: SupabaseClient): UsageService {
  return {
    async monthRows(sinceIso) {
      const { data, error } = await supabase
        .from('ai_usage_mine')
        .select(
          'task, tier, model, cost_eur, ok, error_code, created_at, input_tokens, output_tokens, cache_read_tokens',
        )
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, cost_eur: Number(r.cost_eur) })) as UsageRow[];
    },
    async prices() {
      const { data, error } = await supabase.from('ai_prices').select('*').order('model');
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => ({
        ...p,
        input_per_mtok: Number(p.input_per_mtok),
        output_per_mtok: Number(p.output_per_mtok),
        cache_read_per_mtok: Number(p.cache_read_per_mtok),
        cache_write_per_mtok: Number(p.cache_write_per_mtok),
        eur_rate: Number(p.eur_rate),
      })) as PriceRow[];
    },
    async savePrice(price) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sign in again.');
      const { error } = await supabase.from('ai_prices').upsert(
        { ...price, user_id: auth.user.id, updated_at: new Date().toISOString() },
        {
          onConflict: 'user_id,model',
        },
      );
      if (error) throw new Error(error.message);
    },
  };
}
