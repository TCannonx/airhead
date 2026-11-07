import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { LeaveService } from '../auth/types';

type Outcome = Awaited<ReturnType<LeaveService['suggest']>>;

/** suggest-leave with the signed-in user's token (Task 8.8). */
export function supabaseLeave(supabase: SupabaseClient): LeaveService {
  return {
    async suggest(req) {
      const { data, error } = await supabase.functions.invoke('suggest-leave', { body: req });
      if (!error && data) return data as Outcome;
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res) return res as Outcome;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
