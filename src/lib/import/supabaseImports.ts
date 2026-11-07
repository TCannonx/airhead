import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { ImportOutcome, ImportsService } from '../auth/types';

/** Calls import-extract with the signed-in user's token (Task 4.10). */
export function supabaseImports(supabase: SupabaseClient): ImportsService {
  return {
    async extract(req) {
      const { data, error } = await supabase.functions.invoke('import-extract', { body: req });
      if (!error && data) return data as ImportOutcome;
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res) return res as ImportOutcome;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
