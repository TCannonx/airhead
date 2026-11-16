import type { SupabaseClient } from '@supabase/supabase-js';
import type { NudgesService } from '../auth/types';

/** public.nudge_outcome with the signed-in user's token (Task 13.8). */
export function supabaseNudges(supabase: SupabaseClient): NudgesService {
  return {
    async respond(nudgeId, outcome, snoozeTo) {
      const { error } = await supabase.rpc('nudge_outcome', {
        p_nudge_id: nudgeId,
        p_outcome: outcome,
        p_snooze_to: snoozeTo ?? null,
      });
      if (!error) {
        return {
          ok: true,
          message:
            outcome === 'snoozed'
              ? 'Snoozed.'
              : outcome === 'acted'
                ? 'Marked done.'
                : 'Dismissed.',
        };
      }
      return {
        ok: false,
        message: navigator.onLine
          ? 'That didn’t save. Try again.'
          : 'You’re offline. Try again when you’re back online.',
      };
    },
  };
}
