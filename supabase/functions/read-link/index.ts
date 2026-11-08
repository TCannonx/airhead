import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { linkInfoFor } from './extract.ts';
import { safeFetch } from './safeFetch.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

async function resolve(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}

/**
 * POST /read-link { capture_id }
 * Called by the database when a link capture arrives (service key), or by the
 * capture's owner. Reads the page safely and stores what the next sort batch
 * needs to summarise it. Web content is data only: nothing here acts on it.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as { capture_id?: string };
  if (!body.capture_id) {
    return json({ ok: false, error_code: 'bad_request', message: 'capture_id is required.' }, 400);
  }

  let ownerFilter: string | null = null;
  if (!(await isService(token))) {
    const { data } = await db.auth.getUser(token);
    if (!data.user)
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    ownerFilter = data.user.id;
  }

  let query = db
    .from('captures')
    .select('id, user_id, url, payload, kind')
    .eq('id', body.capture_id);
  if (ownerFilter) query = query.eq('user_id', ownerFilter);
  const { data: capture } = await query.maybeSingle();
  if (!capture?.url || capture.kind !== 'link') {
    return json({ ok: false, error_code: 'not_found', message: 'No link to read.' }, 404);
  }

  const fetched = await safeFetch(capture.url, { fetch, resolve });
  const info = linkInfoFor(capture.url, fetched);
  const now = new Date().toISOString();

  const payload = {
    ...(capture.payload as Record<string, unknown>),
    link: {
      status: info.status,
      title: info.title,
      description: info.description,
      word_count: info.word_count,
      reading_minutes: info.reading_minutes,
      fetched_at: now,
    },
    article_text: info.text,
    // The next sort batch writes the summary and key points, then clears the text.
    summary_pending: info.status === 'read',
  };
  await db.from('captures').update({ payload }).eq('id', capture.id);

  // Update the reading item the free rules created for this link.
  const { data: items } = await db
    .from('items')
    .select('id, title, data')
    .eq('capture_id', capture.id)
    .eq('type', 'reading');
  for (const item of items ?? []) {
    const data = {
      ...(item.data as Record<string, unknown>),
      description: info.description,
      reading_minutes: info.reading_minutes,
      couldnt_read: info.status === 'unreadable',
    };
    const title = item.title === capture.url && info.title ? info.title : item.title;
    await db.from('items').update({ data, title }).eq('id', item.id);
  }

  return json({
    ok: true,
    error_code: null,
    message: info.status === 'unreadable' ? "Couldn't read this page." : 'Link read.',
    status: info.status,
  });
});
