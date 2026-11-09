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
  USER_A,
  USER_B,
} from '../_shared/testing.ts';
import { handleSortBatch } from './handler.ts';
import type { SortBatchOutcome } from './run.ts';

function d(result: Partial<SortBatchOutcome> | Error = {}, apiKey = 'key') {
  const runs: [string, boolean][] = [];
  return {
    runs,
    deps: {
      caller: fakeCaller,
      apiKey: () => apiKey,
      sort: (userId: string, background: boolean) => {
        runs.push([userId, background]);
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve({
          ok: true,
          error_code: null,
          message: 'Sorted.',
          sorted: 1,
          items: 1,
          ...result,
        });
      },
    },
  };
}

Deno.test('sort-batch: preflight, method, missing token, no key', async () => {
  const x = d();
  await assertPreflight(await handleSortBatch(request('OPTIONS'), x.deps));
  assertEquals(await outcome(await handleSortBatch(request('GET', TOKEN_A), x.deps)), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleSortBatch(post({}), x.deps)), [401, 'unauthorized']);
  assertEquals(await outcome(await handleSortBatch(post({}, 'not-a-token'), x.deps)), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleSortBatch(post({}, TOKEN_A), d({}, '').deps)), [
    503,
    'not_configured',
  ]);
  assertEquals(x.runs, []);
});

Deno.test(
  'sort-batch: a user sorts only their own captures; a user_id in the body is ignored',
  async () => {
    const x = d();
    assertEquals(await outcome(await handleSortBatch(post({ user_id: USER_B }, TOKEN_A), x.deps)), [
      200,
      null,
    ]);
    assertEquals(x.runs, [[USER_A, false]]);
  },
);

Deno.test(
  'sort-batch: the service names the user; without one (or bad JSON) it is refused',
  async () => {
    const x = d();
    assertEquals(await outcome(await handleSortBatch(post({ user_id: USER_B }, SERVICE), x.deps)), [
      200,
      null,
    ]);
    assertEquals(await outcome(await handleSortBatch(post({}, SERVICE), x.deps)), [
      401,
      'unauthorized',
    ]);
    assertEquals(await outcome(await handleSortBatch(badJson(SERVICE), x.deps)), [
      401,
      'unauthorized',
    ]);
    assertEquals(x.runs, [[USER_B, true]]);
  },
);

Deno.test(
  'sort-batch: cap → 402, AI failure → 502, a crash → 500 with a plain message',
  async () => {
    const cap = d({ ok: false, error_code: 'cap_reached' });
    assertEquals(await outcome(await handleSortBatch(post({}, TOKEN_A), cap.deps)), [
      402,
      'cap_reached',
    ]);
    const api = d({ ok: false, error_code: 'api_error' });
    assertEquals(await outcome(await handleSortBatch(post({}, TOKEN_A), api.deps)), [
      502,
      'api_error',
    ]);
    const crash = d(new Error('db down: secret detail'));
    const res = await handleSortBatch(post({}, TOKEN_A), crash.deps);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).message, 'Sorting failed. It will be tried again.');
  },
);
