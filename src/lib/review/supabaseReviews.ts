import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { ReviewsService } from '../auth/types';

/** weekly-review { mode: 'run' } with the signed-in user's token (Task 8.4). */
export function supabaseReviews(supabase: SupabaseClient): ReviewsService {
  return {
    async run() {
      const { data, error } = await supabase.functions.invoke('weekly-review', {
        body: { mode: 'run' },
      });
      if (!error && data) return data as { ok: boolean; message: string };
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res)
          return res as { ok: boolean; message: string };
      }
      return {
        ok: false,
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
