import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkshopOutcome, WorkshopService } from '../auth/types';

/** Calls the workshop function with the signed-in user's token (Tasks 7.6–7.7). */
export function supabaseWorkshop(supabase: SupabaseClient): WorkshopService {
  async function call(body: Record<string, unknown>): Promise<WorkshopOutcome> {
    const { data, error } = await supabase.functions.invoke('workshop', { body });
    if (!error && data) return data as WorkshopOutcome;
    if (error instanceof FunctionsHttpError) {
      const res = await (error.context as Response).json().catch(() => null);
      if (res && typeof res === 'object' && 'message' in res) return res as WorkshopOutcome;
    }
    return {
      ok: false,
      error_code: 'unreachable',
      message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
    };
  }
  return {
    fleshOut: (itemId) => call({ mode: 'flesh_out', item_id: itemId }),
  };
}
