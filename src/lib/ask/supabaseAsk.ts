import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { AskOutcome, AskService } from '../auth/types';

/** Calls ask with the signed-in user's token (Task 7.10). */
export function supabaseAsk(supabase: SupabaseClient): AskService {
  return {
    async ask(question) {
      const { data, error } = await supabase.functions.invoke('ask', { body: { question } });
      if (!error && data) return data as AskOutcome;
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res) return res as AskOutcome;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
