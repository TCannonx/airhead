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
  TOKEN_B,
  USER_A,
  usage,
} from '../_shared/testing.ts';
import { handleWorkshop } from './handler.ts';
import type { TurnDeps } from './turn.ts';

const ITEM_OF_A = '22222222-2222-4222-8222-222222222222';
const DRAFT = { summary: 'A shed.', sections: [], open_questions: [], next_steps: [] };

/** Like the real store: an item is found only for its owner. */
const d = (ai: AIClient, apiKey = 'key') => ({
  caller: fakeCaller,
  apiKey: () => apiKey,
  runDeps: (userId: string): TurnDeps => ({
    ai,
    store: usage,
    load: (itemId) =>
      Promise.resolve(
        itemId === ITEM_OF_A && userId === USER_A
          ? {
              item: { id: ITEM_OF_A, title: 'Shed', body: null, data: {} },
              captureText: null,
              pageText: null,
              facts: [],
              current: null,
            }
          : null,
      ),
    saveDraft: (item_id, content, source) => Promise.resolve({ item_id, content, source }),
    loadTurns: () => Promise.resolve([]),
    saveTurns: (id, turns) => Promise.resolve({ id, turns }),
  }),
});

Deno.test('workshop: preflight, method, missing or service token, no key, bad JSON', async () => {
  const { ai, calls } = noAI();
  const body = { mode: 'flesh_out', item_id: ITEM_OF_A };
  await assertPreflight(await handleWorkshop(request('OPTIONS'), d(ai)));
  assertEquals(await outcome(await handleWorkshop(request('GET', TOKEN_A), d(ai))), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleWorkshop(post(body), d(ai))), [401, 'unauthorized']);
  assertEquals(await outcome(await handleWorkshop(post(body, SERVICE), d(ai))), [
    401,
    'unauthorized',
  ]);
  assertEquals(await outcome(await handleWorkshop(post(body, TOKEN_A), d(ai, ''))), [
    503,
    'not_configured',
  ]);
  assertEquals(await outcome(await handleWorkshop(badJson(TOKEN_A), d(ai))), [400, 'bad_request']);
  assertEquals(
    await outcome(
      await handleWorkshop(post({ mode: 'other', item_id: ITEM_OF_A }, TOKEN_A), d(ai)),
    ),
    [400, 'bad_request'],
  );
  assertEquals(calls.length, 0);
});

Deno.test('workshop: another user’s idea is not found; the owner gets a draft', async () => {
  const none = noAI();
  for (const mode of ['flesh_out', 'turn'])
    assertEquals(
      await outcome(await handleWorkshop(post({ mode, item_id: ITEM_OF_A }, TOKEN_B), d(none.ai))),
      [404, 'not_found'],
    );
  assertEquals(none.calls.length, 0);
  const { ai } = fakeAI(DRAFT);
  assertEquals(
    await outcome(
      await handleWorkshop(post({ mode: 'flesh_out', item_id: ITEM_OF_A }, TOKEN_A), d(ai)),
    ),
    [200, null],
  );
});
