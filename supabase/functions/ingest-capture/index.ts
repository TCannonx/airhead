import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { runIngest, type IngestBody } from './run.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const text = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * POST /ingest-capture  Authorization: Bearer <capture token>
 * { text?, url?, image? (base64), image_type? }  →  plain-text reply.
 * Called by iOS Shortcuts only (no browser CORS: the bookmarklet uses /share).
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Use POST.', 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const body = (await req.json().catch(() => ({}))) as IngestBody;
  const res = await runIngest(token, body, {
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
  }).catch(() => ({ status: 500, message: 'Airhead couldn’t save that. Try again.' }));
  return text(res.message, res.status);
});
