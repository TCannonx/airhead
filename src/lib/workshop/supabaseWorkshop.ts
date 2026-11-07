import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkshopOutcome, WorkshopService, WorkshopTurnOutcome } from '../auth/types';

/** Calls the workshop function with the signed-in user's token (Tasks 7.6–7.7). */
export function supabaseWorkshop(supabase: SupabaseClient): WorkshopService {
  async function call<T extends WorkshopOutcome | WorkshopTurnOutcome>(
    body: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await supabase.functions.invoke('workshop', { body });
    if (!error && data) return data as T;
    if (error instanceof FunctionsHttpError) {
      const res = await (error.context as Response).json().catch(() => null);
      if (res && typeof res === 'object' && 'message' in res) return res as T;
    }
    return {
      ok: false,
      error_code: 'unreachable',
      message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
    } as T;
  }
  return {
    fleshOut: (itemId) => call<WorkshopOutcome>({ mode: 'flesh_out', item_id: itemId }),
    turn: (itemId, answer) => call<WorkshopTurnOutcome>({ mode: 'turn', item_id: itemId, answer }),
  };
}
