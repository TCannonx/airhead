import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { CalendarOutcome, CalendarsService } from '../auth/types';

const offline: CalendarOutcome = {
  ok: false,
  error_code: 'unreachable',
  message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
};

/** Calls fetch-linked-calendars with the signed-in user's token (Task 4.9). */
export function supabaseCalendars(supabase: SupabaseClient): CalendarsService {
  async function call(body: Record<string, unknown>): Promise<CalendarOutcome> {
    const { data, error } = await supabase.functions.invoke('fetch-linked-calendars', { body });
    if (!error && data) return data as CalendarOutcome;
    if (error instanceof FunctionsHttpError) {
      const res = await (error.context as Response).json().catch(() => null);
      if (res && typeof res === 'object' && 'message' in res) return res as CalendarOutcome;
    }
    return offline;
  }
  return {
    validate: (url) => call({ mode: 'validate', url }),
    refresh: (feedId) => call({ mode: 'sync', feed_id: feedId }),
  };
}
