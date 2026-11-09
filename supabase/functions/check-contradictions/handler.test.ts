import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { AIClient } from '../_shared/ai.ts';
import {
  assertPreflight,
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
import { handleContradictions } from './handler.ts';

const FACTS = [
  { id: 'f1', text: 'Trains on Tuesdays' },
  { id: 'f2', text: 'Trains on Mondays' },
];

function d(ai: AIClient, apiKey = 'key') {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      caller: fakeCaller,
      apiKey: () => apiKey,
      ai: () => ai,
      usage,
      facts: (userId: string) => {
        asked.push(userId);
        return Promise.resolve(FACTS);
      },
    },
  };
}

Deno.test('check-contradictions: preflight, missing or service token, no key', async () => {
  const { ai, calls } = noAI();
  await assertPreflight(await handleContradictions(request('OPTIONS'), d(ai).deps));
  assertEquals(await outcome(await handleContradictions(post({}), d(ai).deps)), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleContradictions(post({}, SERVICE), d(ai).deps)), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleContradictions(post({}, TOKEN_A), d(ai, '').deps)), [
    503,
    'not_configured',
  ]);
  assertEquals(calls.length, 0);
});

Deno.test(
  'check-contradictions: reads only the token’s user’s facts (no body is read)',
  async () => {
    const { ai } = fakeAI({
      conflicts: [{ fact_ids: ['f1', 'f2'], explanation: 'Different days.', merged_text: null }],
    });
    const { deps, asked } = d(ai);
    const res = await handleContradictions(post({ user_id: USER_B }, TOKEN_A), deps);
    assertEquals(await outcome(res), [200, null]);
    assertEquals(asked, [USER_A]);
  },
);
