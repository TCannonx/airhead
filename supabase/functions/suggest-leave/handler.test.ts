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
import { handleSuggestLeave } from './handler.ts';

const d = (ai: AIClient, apiKey = 'key') => ({
  caller: fakeCaller,
  apiKey: () => apiKey,
  ai: () => ai,
  usage,
});
const BODY = {
  today: '2026-04-20',
  candidates: [{ leave: ['2026-05-05'], start: '2026-05-02', end: '2026-05-05', days_off: 4 }],
  context: { occasions: [], days_since_break: null, busy_weeks: [] },
};

Deno.test('suggest-leave: preflight, method, missing or service token, no key', async () => {
  const { ai, calls } = noAI();
  await assertPreflight(await handleSuggestLeave(request('OPTIONS'), d(ai)));
  assertEquals(await outcome(await handleSuggestLeave(request('GET', TOKEN_A), d(ai))), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleSuggestLeave(post(BODY), d(ai))), [401, 'unauthorized']);
  assertEquals(await outcome(await handleSuggestLeave(post(BODY, SERVICE), d(ai))), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleSuggestLeave(post(BODY, TOKEN_A), d(ai, ''))), [
    503,
    'not_configured',
  ]);
  assertEquals(await outcome(await handleSuggestLeave(badJson(TOKEN_A), d(ai))), [
    400,
    'bad_request',
  ]);
  assertEquals(calls.length, 0);
});

Deno.test('suggest-leave: the usage row is the token’s user, whatever the body says', async () => {
  const { ai, calls } = fakeAI({ picks: [{ n: 1, why: 'Good.' }] });
  const users: string[] = [];
  const res = await handleSuggestLeave(post({ ...BODY, user_id: USER_B }, TOKEN_A), {
    ...d(ai),
    usage: { ...usage, record: (r) => (users.push(r.user_id), Promise.resolve()) },
  });
  assertEquals(await outcome(res), [200, null]);
  assertEquals([calls.length, users], [1, [USER_A]]);
});
