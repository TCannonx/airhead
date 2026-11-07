import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { ContradictionsOutcome, MemoryService } from '../auth/types';

/** Calls the check-contradictions Edge Function with the signed-in user's token. */
export function supabaseMemory(supabase: SupabaseClient): MemoryService {
  return {
    async checkContradictions() {
      const { data, error } = await supabase.functions.invoke('check-contradictions', { body: {} });
      if (!error && data) return data as ContradictionsOutcome;
      if (error instanceof FunctionsHttpError) {
        const body = await (error.context as Response).json().catch(() => null);
        if (body && 'message' in body) return body as ContradictionsOutcome;
      }
      return {
        ok: false,
        error_code: 'unreachable',
        message: 'The check could not run. Try again when you are online.',
        conflicts: [],
      };
    },
  };
}
