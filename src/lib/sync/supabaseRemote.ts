import type { SupabaseClient } from '@supabase/supabase-js';
import type { Remote, RemoteRow } from './types';

/** PostgREST filter values containing : . + must be double-quoted inside or(). */
const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

export function supabaseRemote(supabase: SupabaseClient): Remote {
  return {
    async upsert(table, rows) {
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`push ${table}: ${error.message}`);
    },

    async pullPage(table, after, limit) {
      let query = supabase
        .from(table)
        .select('*')
        .order('server_updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (after) {
        const ts = quote(after.ts);
        query = query.or(
          `server_updated_at.gt.${ts},and(server_updated_at.eq.${ts},id.gt.${after.id})`,
        );
      }
      const { data, error } = await query;
      if (error) throw new Error(`pull ${table}: ${error.message}`);
      return (data ?? []) as RemoteRow[];
    },

    subscribe(onChange) {
      // Realtime applies RLS: only this user's changes arrive.
      const channel = supabase
        .channel(`sync-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
