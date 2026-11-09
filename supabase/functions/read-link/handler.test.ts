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
} from '../_shared/testing.ts';
import { handleReadLink, type LinkCapture } from './handler.ts';

const CAPTURE: LinkCapture = {
  id: 'c1',
  user_id: USER_A,
  url: 'https://example.com/a',
  payload: {},
  kind: 'link',
};

function d() {
  const read: string[] = [];
  return {
    read,
    deps: {
      caller: fakeCaller,
      // Like the real query: with an owner, only that owner's capture.
      findCapture: (id: string, owner: string | null) =>
        Promise.resolve(
          id === CAPTURE.id && (!owner || owner === CAPTURE.user_id) ? CAPTURE : null,
        ),
      read: (c: LinkCapture) => {
        read.push(c.id);
        return Promise.resolve({ status: 'read' });
      },
    },
  };
}

Deno.test('read-link: preflight, method, bad JSON, missing token', async () => {
  const x = d();
  await assertPreflight(await handleReadLink(request('OPTIONS'), x.deps));
  assertEquals(await outcome(await handleReadLink(request('GET', TOKEN_A), x.deps)), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleReadLink(badJson(TOKEN_A), x.deps)), [400, 'bad_request']);
  assertEquals(await outcome(await handleReadLink(post({ capture_id: 'c1' }), x.deps)), [
    401,
    'unauthorized',
  ]);
  assertEquals(x.read, []);
});

Deno.test(
  'read-link: another user’s capture is not found; the owner and the service read it',
  async () => {
    const x = d();
    assertEquals(await outcome(await handleReadLink(post({ capture_id: 'c1' }, TOKEN_B), x.deps)), [
      404,
      'not_found',
    ]);
    assertEquals(x.read, []);
    assertEquals(await outcome(await handleReadLink(post({ capture_id: 'c1' }, TOKEN_A), x.deps)), [
      200,
      null,
    ]);
    assertEquals(await outcome(await handleReadLink(post({ capture_id: 'c1' }, SERVICE), x.deps)), [
      200,
      null,
    ]);
    assertEquals(x.read, ['c1', 'c1']);
  },
);
