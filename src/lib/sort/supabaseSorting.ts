import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { SortOutcome, SortingService } from '../auth/types';

const isOutcome = (v: unknown): v is SortOutcome =>
  !!v && typeof v === 'object' && 'message' in v && 'ok' in v;

/** Calls the sort-batch Edge Function with the signed-in user's token. */
export function supabaseSorting(supabase: SupabaseClient): SortingService {
  return {
    async sortNow() {
      const { data, error } = await supabase.functions.invoke('sort-batch', { body: {} });
      if (!error && isOutcome(data)) return data;
      // Non-2xx responses still carry our { ok, error_code, message } body.
      if (error instanceof FunctionsHttpError) {
        const body = await (error.context as Response).json().catch(() => null);
        if (isOutcome(body)) return body;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'Sorting could not start. It will run automatically later.',
      };
    },
  };
}
