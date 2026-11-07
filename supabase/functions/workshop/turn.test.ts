import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { RECENT_TURNS, runTurn, type Turn, type TurnDeps } from './turn.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const DRAFT = {
  summary: 'A shed.',
  sections: [],
  open_questions: [],
  next_steps: ['Measure the wall'],
};
const OUTPUT = {
  questions: ['How big should it be?', 'Timber or metal?', 'Budget?', 'A fourth one'],
  draft: { ...DRAFT, summary: 'A 2 x 3 m timber shed.' },
};

function deps(turns: Turn[]) {
  const calls: Record<string, unknown>[] = [];
  const saved: { content: unknown; src: string }[] = [];
  const sessions: Turn[][] = [];
  const ai = {
    messages: {
      parse: (params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve({
          parsed_output: OUTPUT,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 2000,
            output_tokens: 700,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      },
    },
  } as unknown as AIClient;
  const store: UsageStore = {
    price: () =>
      Promise.resolve({
        model: 'claude-sonnet-5-5',
        input_per_mtok: 2,
        output_per_mtok: 10,
        cache_read_per_mtok: 0.2,
        cache_write_per_mtok: 2.5,
        eur_rate: 0.86,
      }),
    monthlyCapEur: () => Promise.resolve(null),
    monthToDateEur: () => Promise.resolve(0),
    record: () => Promise.resolve(),
  };
  const d: TurnDeps = {
    ai,
    store,
    load: () =>
      Promise.resolve({
        item: { id: ITEM, title: 'Garden shed', body: null, data: {} },
        captureText: null,
        pageText: 'a very long page that must not be sent with turns',
        facts: [],
        current: DRAFT,
      }),
    saveDraft: (_id, content, src) => {
      saved.push({ content, src });
      return Promise.resolve({ id: 'd2', version: 2, content, source: src });
    },
    loadTurns: () => Promise.resolve(turns),
    saveTurns: (_id, t) => {
      sessions.push(t);
      return Promise.resolve({ id: ITEM, turns: t, pending: null });
    },
    now: () => new Date('2026-07-15T10:00:00Z'),
  };
  return { d, calls, saved, sessions };
}

type Msg = { content: string };
const turn = (i: number): Turn => ({
  role: i % 2 ? 'me' : 'airhead',
  text: `turn ${i}`,
  at: '2026-07-15T09:00:00Z',
});

Deno.test(
  'a turn sends the draft, only the recent turns and the answer; returns 2–3 questions and a new version',
  async () => {
    const history = Array.from({ length: 10 }, (_, i) => turn(i));
    const { d, calls, saved, sessions } = deps(history);
    const res = await runTurn(ITEM, '  About 2 by 3 metres  ', USER, d);
    assert(res.ok);
    const msg = (calls[0]?.messages as Msg[])[0]?.content ?? '';
    assertStringIncludes(msg, '<draft>\nA shed.');
    assertStringIncludes(msg, '<answer>\nAbout 2 by 3 metres\n</answer>');
    assertStringIncludes(msg, 'turn 9');
    assertStringIncludes(msg, `turn ${10 - RECENT_TURNS}`);
    assertEquals(msg.includes(`turn ${9 - RECENT_TURNS}\n`), false);
    assertEquals(msg.includes('very long page'), false);
    assertEquals(calls[0]?.model, 'claude-sonnet-5-5');

    assertEquals(
      saved.map((s) => s.src),
      ['session'],
    );
    const written = sessions[0] ?? [];
    assertEquals(written.length, 12);
    assertEquals(written.at(-2), {
      role: 'me',
      text: 'About 2 by 3 metres',
      at: '2026-07-15T10:00:00.000Z',
    });
    assertEquals(written.at(-1)?.text, 'How big should it be?\nTimber or metal?\nBudget?');
  },
);

Deno.test('the first turn has no answer and just asks', async () => {
  const { d, calls, sessions } = deps([]);
  const res = await runTurn(ITEM, null, USER, d);
  assert(res.ok);
  assertStringIncludes(
    (calls[0]?.messages as Msg[])[0]?.content ?? '',
    'Ask your first questions.',
  );
  assertEquals(
    sessions[0]?.map((t) => t.role),
    ['airhead'],
  );
});
