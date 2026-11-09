import { assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  assertPreflight,
  badJson,
  fakeCaller,
  outcome,
  post,
  request,
  SERVICE,
  TOKEN_A,
  TOKEN_B,
  USER_A,
  USER_B,
} from '../_shared/testing.ts';
import { handleLinked } from './handler.ts';
import type { LinkedFeed } from './sync.ts';

const FEEDS: LinkedFeed[] = [
  { id: 'feed-a', user_id: USER_A, url: 'https://a.example/a.ics' },
  { id: 'feed-b', user_id: USER_B, url: 'https://b.example/b.ics' },
];

function d() {
  const synced: string[] = [];
  return {
    synced,
    deps: {
      caller: fakeCaller,
      validate: () => Promise.resolve({ ok: true as const, name: 'Club', count: 3 }),
      // Like the real query: limited to the user when there is one.
      feeds: ({ feedId, userId }: { feedId: string | null; userId: string | null }) =>
        Promise.resolve(
          FEEDS.filter((f) => (!feedId || f.id === feedId) && (!userId || f.user_id === userId)),
        ),
      sync: (feed: LinkedFeed) => {
        synced.push(feed.id);
        return Promise.resolve({ ok: true as const, count: 1, removed: 0 });
      },
    },
  };
}

Deno.test(
  'fetch-linked-calendars: preflight, method, missing token, bad JSON, unknown mode',
  async () => {
    const x = d();
    await assertPreflight(await handleLinked(request('OPTIONS'), x.deps));
    assertEquals(await outcome(await handleLinked(request('GET', TOKEN_A), x.deps)), [
      405,
      'method_not_allowed',
    ]);
    assertEquals(await outcome(await handleLinked(post({ mode: 'sync' }), x.deps)), [
      401,
      'unauthorized',
    ]);
    assertEquals(await outcome(await handleLinked(badJson(TOKEN_A), x.deps)), [400, 'bad_request']);
    assertEquals(await outcome(await handleLinked(post({ mode: 'validate' }, TOKEN_A), x.deps)), [
      400,
      'bad_request',
    ]);
    assertEquals(
      await outcome(
        await handleLinked(post({ mode: 'validate', url: 'https://x/a.ics' }, TOKEN_A), x.deps),
      ),
      [200, null],
    );
    assertEquals(x.synced, []);
  },
);

Deno.test(
  'fetch-linked-calendars: a user syncs only their own; another user’s feed is not found',
  async () => {
    const x = d();
    assertEquals(
      await outcome(await handleLinked(post({ mode: 'sync', feed_id: 'feed-a' }, TOKEN_B), x.deps)),
      [404, 'not_found'],
    );
    assertEquals(await outcome(await handleLinked(post({ mode: 'sync' }, TOKEN_A), x.deps)), [
      200,
      null,
    ]);
    assertEquals(x.synced, ['feed-a']);
    // The scheduler (service key) refreshes every feed.
    assertEquals(await outcome(await handleLinked(post({ mode: 'sync' }, SERVICE), x.deps)), [
      200,
      null,
    ]);
    assertEquals(x.synced, ['feed-a', 'feed-a', 'feed-b']);
  },
);
