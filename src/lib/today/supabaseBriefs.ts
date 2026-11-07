import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { BriefsService } from '../auth/types';

/** morning-brief { mode: 'regenerate' } with the signed-in user's token (Task 5.9). */
export function supabaseBriefs(supabase: SupabaseClient): BriefsService {
  return {
    async regenerate() {
      const { data, error } = await supabase.functions.invoke('morning-brief', {
        body: { mode: 'regenerate' },
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
