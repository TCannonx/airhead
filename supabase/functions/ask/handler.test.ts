import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { AIClient } from '../_shared/ai.ts';
import {
  assertPreflight,
  badJson,
  fakeAI,
  fakeCaller,
  noAI,
  outcome,
  post,
  request,
  SERVICE,
  TOKEN_A,
  USER_A,
  USER_B,
  usage,
} from '../_shared/testing.ts';
import { handleAsk } from './handler.ts';

function deps(ai: AIClient, apiKey: string | undefined = 'key') {
  const seen: [string, string][] = [];
  return {
    seen,
    d: {
      caller: fakeCaller,
      apiKey: () => apiKey,
      runDeps: (userId: string, token: string) => {
        seen.push([userId, token]);
        return {
          ai,
          store: usage,
          embed: () => Promise.resolve([0.1]),
          search: () => Promise.resolve([{ item_id: 'i1', content: 'Travel is cut.' }]),
          items: () => Promise.resolve(new Map([['i1', { title: 'Budget', type: 'note' }]])),
          tier: () => Promise.resolve('small' as const),
        };
      },
    },
  };
}

Deno.test('ask: preflight, method, missing or service token', async () => {
  const { ai, calls } = noAI();
  const { d } = deps(ai);
  await assertPreflight(await handleAsk(request('OPTIONS'), d));
  assertEquals(await outcome(await handleAsk(request('GET', TOKEN_A), d)), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleAsk(post({ question: 'q' }), d)), [401, 'unauthorized']);
  // A user-only function: the service key is not a user.
  assertEquals(await outcome(await handleAsk(post({ question: 'q' }, SERVICE), d)), [
    401,
    'unauthorized',
  ]);
  assertEquals(calls.length, 0);
});

Deno.test('ask: no AI key → 503; bad JSON → 400 without an AI call', async () => {
  const { ai, calls } = noAI();
  assertEquals(await outcome(await handleAsk(post({ question: 'q' }, TOKEN_A), deps(ai, '').d)), [
    503,
    'not_configured',
  ]);
  assertEquals(await outcome(await handleAsk(badJson(TOKEN_A), deps(ai).d)), [400, 'bad_request']);
  assertEquals(calls.length, 0);
});

Deno.test('ask: runs as the token’s user; a user id in the body is ignored', async () => {
  const { ai } = fakeAI({ answer: 'Travel is cut.', citations: [1] });
  const { d, seen } = deps(ai);
  const res = await handleAsk(post({ question: 'Travel?', user_id: USER_B }, TOKEN_A), d);
  assertEquals(await outcome(res), [200, null]);
  assertEquals(seen, [[USER_A, TOKEN_A]]);
});
