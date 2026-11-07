import {
  buildFeed,
  type FeedItem,
  type FeedKind,
  type FeedLeave,
  type FeedWorkDay,
} from './feed.ts';

/** What the handler needs from the database (a fake in tests, Supabase in production). */
export interface FeedStore {
  findFeed(
    tokenHash: string,
  ): Promise<{ user_id: string; kind: string; enabled: boolean; deleted_at: string | null } | null>;
  loadData(userId: string): Promise<{
    settings: Record<string, unknown>;
    items: FeedItem[];
    leave: FeedLeave[];
    workDays: FeedWorkDay[];
  }>;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * GET /calendar-feed?t=<token>: the published iCalendar for an outgoing feed.
 * The token is the secret; only its SHA-256 is stored. Unknown, revoked
 * (deleted) or switched-off feeds all look the same: 404.
 */
export async function handleFeed(
  req: Request,
  store: FeedStore,
  now = new Date(),
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (token.length < 20 || token.length > 200) return notFound();
  const feed = await store.findFeed(await sha256Hex(token));
  if (!feed || feed.deleted_at || !feed.enabled) return notFound();
  if (feed.kind !== 'us_out' && feed.kind !== 'me_out') return notFound();
  const data = await store.loadData(feed.user_id);
  const body = buildFeed({ kind: feed.kind as FeedKind, userId: feed.user_id, now, ...data });
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${feed.kind === 'us_out' ? 'us' : 'airhead'}.ics"`,
      // Calendar apps poll; a short cache keeps repeated polls cheap.
      'cache-control': 'private, max-age=300',
    },
  });
}
