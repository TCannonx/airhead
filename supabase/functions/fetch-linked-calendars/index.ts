import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { syncFeed, validateLink, type LinkedFeed, type LinkedStore } from './sync.ts';

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
const fetchDeps = { fetch, resolve };

const store: LinkedStore = {
  async existingKeys(feedId) {
    const keys = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db
        .from('external_events')
        .select('id, occurrence_key')
        .eq('feed_id', feedId)
        .is('deleted_at', null)
        .order('id')
        .range(from, from + 999);
      for (const r of data ?? []) keys.set(r.occurrence_key as string, r.id as string);
      if (!data || data.length < 1000) break;
    }
    return keys;
  },
  async upsert(rows) {
    const { error } = await db
      .from('external_events')
      .upsert(rows, { onConflict: 'feed_id,occurrence_key' });
    if (error) throw new Error(error.message);
  },
  async softDelete(ids) {
    await db.from('external_events').update({ deleted_at: new Date().toISOString() }).in('id', ids);
  },
  async markFeed(feedId, patch) {
    await db.from('feeds').update(patch).eq('id', feedId);
  },
};

/**
 * POST /fetch-linked-calendars
 *   { mode: 'validate', url }  (signed in): fetch and parse a pasted link; stores nothing.
 *   { mode: 'sync', feed_id? } (scheduler with the service key, or the owner for one
 *   feed): refresh linked calendars into external_events.
 * Calendar contents are data only; nothing in them is acted on.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const isService = !!SERVICE_KEY && token === SERVICE_KEY;
  let userId: string | null = null;
  if (!isService) {
    const { data } = await db.auth.getUser(token);
    if (!data.user) {
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    }
    userId = data.user.id;
  }
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    url?: string;
    feed_id?: string;
  };

  if (body.mode === 'validate') {
    if (!body.url) {
      return json({ ok: false, error_code: 'bad_request', message: 'Paste a calendar link.' }, 400);
    }
    const res = await validateLink(body.url, fetchDeps);
    return res.ok
      ? json({ ...res, error_code: null, message: `Found ${res.count} events.` })
      : json({ ok: false, error_code: 'invalid', message: res.error }, 200);
  }

  if (body.mode === 'sync') {
    let query = db
      .from('feeds')
      .select('id, user_id, url')
      .eq('kind', 'linked_in')
      .eq('enabled', true)
      .is('deleted_at', null)
      .not('url', 'is', null);
    if (body.feed_id) query = query.eq('id', body.feed_id);
    if (userId) query = query.eq('user_id', userId);
    else if (!body.feed_id) query = query.limit(200);
    const { data: feeds } = await query;
    if (userId && body.feed_id && !feeds?.length) {
      return json({ ok: false, error_code: 'not_found', message: 'Calendar not synced yet.' }, 404);
    }
    const results = [];
    for (const feed of (feeds ?? []) as LinkedFeed[]) {
      results.push({ feed_id: feed.id, ...(await syncFeed(feed, fetchDeps, store)) });
    }
    const failed = results.filter((r) => !r.ok);
    return json({
      ok: failed.length === 0,
      error_code: failed.length ? 'partial' : null,
      message: failed.length ? `${failed.length} calendar(s) couldn’t be read.` : 'Up to date.',
      results,
    });
  }

  return json({ ok: false, error_code: 'bad_request', message: 'Unknown mode.' }, 400);
});
