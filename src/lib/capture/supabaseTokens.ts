import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureTokensService } from '../auth/types';
import { hashToken, newTokenValue, type CaptureTokenRow } from './tokens';

const failed = () => new Error('Couldn’t reach Airhead’s server. Try again when you’re online.');

/** Capture tokens straight from the table (own-rows RLS); not synced to devices (Task 7.1). */
export function supabaseTokens(supabase: SupabaseClient): CaptureTokensService {
  return {
    async list() {
      const { data, error } = await supabase
        .from('capture_tokens')
        .select('id, label, created_at, last_used_at, revoked_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw failed();
      return (data ?? []) as CaptureTokenRow[];
    },
    async create(label) {
      const token = newTokenValue();
      const { error } = await supabase
        .from('capture_tokens')
        .insert({ label, token_hash: await hashToken(token) });
      if (error) throw failed();
      return token;
    },
    async revoke(id) {
      const { error } = await supabase
        .from('capture_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw failed();
    },
  };
}
