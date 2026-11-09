import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { handleIngest } from './handler.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** POST /ingest-capture with a capture token: see handler.ts. */
Deno.serve((req) =>
  handleIngest(req, {
    async lookup(hash) {
      const { data, error } = await db.rpc('use_capture_token', { p_hash: hash });
      if (error) throw new Error(error.message);
      const row = (data as { user_id: string; allowed: boolean }[] | null)?.[0];
      return row ? { user_id: row.user_id, allowed: row.allowed } : null;
    },
    async insert(row) {
      const { error } = await db.from('captures').insert(row);
      if (error) throw new Error(error.message);
    },
    async upload(path, bytes, mime) {
      const { error } = await db.storage
        .from('captures')
        .upload(path, bytes, { contentType: mime });
      if (error) throw new Error(error.message);
    },
  }),
);
