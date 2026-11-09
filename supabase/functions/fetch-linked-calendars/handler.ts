import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import type { LinkedFeed, syncFeed, validateLink } from './sync.ts';

export interface LinkedHandlerDeps {
  caller: Caller;
  validate(url: string): ReturnType<typeof validateLink>;
  /**
   * Enabled linked calendars: one by id, only the user's own when `userId` is
   * set, and at most 200 for a service run without an id.
   */
  feeds(q: { feedId: string | null; userId: string | null }): Promise<LinkedFeed[]>;
  sync(feed: LinkedFeed): ReturnType<typeof syncFeed>;
}

/**
 * POST /fetch-linked-calendars
 *   { mode: 'validate', url }  (signed in): fetch and parse a pasted link; stores nothing.
 *   { mode: 'sync', feed_id? } (scheduler with the service key, or the owner for one
 *   feed): refresh linked calendars into external_events.
 * Calendar contents are data only; nothing in them is acted on.
 */
export async function handleLinked(req: Request, d: LinkedHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = bearer(req);
  const serviceCall = await d.caller.isService(token);
  let userId: string | null = null;
  if (!serviceCall) {
    userId = await d.caller.userId(token);
    if (!userId) {
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    }
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
    const res = await d.validate(body.url);
    return res.ok
      ? json({ ...res, error_code: null, message: `Found ${res.count} events.` })
      : json({ ok: false, error_code: 'invalid', message: res.error }, 200);
  }

  if (body.mode === 'sync') {
    const feeds = await d.feeds({ feedId: body.feed_id ?? null, userId });
    if (userId && body.feed_id && !feeds.length) {
      return json({ ok: false, error_code: 'not_found', message: 'Calendar not synced yet.' }, 404);
    }
    const results = [];
    for (const feed of feeds) {
      results.push({ feed_id: feed.id, ...(await d.sync(feed)) });
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
}
