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
import { handleSummarise } from './handler.ts';

const d = (ai: AIClient, apiKey = 'key') => ({
  caller: fakeCaller,
  apiKey: () => apiKey,
  ai: () => ai,
  usage,
});
const BODY = { kind: 'typed', title: 'Sync', html: '<p>Launch moves to Friday.</p>' };

Deno.test('summarise-note: preflight, method, missing or service token, no key', async () => {
  const { ai, calls } = noAI();
  await assertPreflight(await handleSummarise(request('OPTIONS'), d(ai)));
  assertEquals(await outcome(await handleSummarise(request('PUT', TOKEN_A), d(ai))), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleSummarise(post(BODY), d(ai))), [401, 'unauthorized']);
  assertEquals(await outcome(await handleSummarise(post(BODY, SERVICE), d(ai))), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleSummarise(post(BODY, TOKEN_A), d(ai, ''))), [
    503,
    'not_configured',
  ]);
  assertEquals(await outcome(await handleSummarise(badJson(TOKEN_A), d(ai))), [400, 'bad_request']);
  assertEquals(calls.length, 0);
});

Deno.test('summarise-note: runs for the token’s user, whatever the body says', async () => {
  const { ai } = fakeAI({ transcription: null, summary: 'Moved.', decisions: [], actions: [] });
  const users: string[] = [];
  const res = await handleSummarise(post({ ...BODY, user_id: USER_B }, TOKEN_A), {
    ...d(ai),
    usage: { ...usage, record: (r) => (users.push(r.user_id), Promise.resolve()) },
  });
  assertEquals(await outcome(res), [200, null]);
  assertEquals(users, [USER_A]);
});
