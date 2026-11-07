import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { NotesService, SummariseOutcome } from '../auth/types';

/** Calls summarise-note with the signed-in user's token (Task 6.7). */
export function supabaseNotes(supabase: SupabaseClient): NotesService {
  return {
    async summarise(req) {
      const { data, error } = await supabase.functions.invoke('summarise-note', { body: req });
      if (!error && data) return data as SummariseOutcome;
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res) return res as SummariseOutcome;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
