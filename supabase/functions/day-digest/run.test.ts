import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fx from '../../../tests/fixtures/ai/day-digest.json' with { type: 'json' };
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { DAY_DIGEST_SYSTEM } from '../_shared/prompts/day-digest.v1.ts';
import {
  clampWords,
  type DayDigestStore,
  type DaySource,
  isEmptyDay,
  NOTHING_RECORDED,
  runDayDigests,
  sourceIds,
} from './run.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const SOURCE = fx.source as DaySource;
const EMPTY: DaySource = { ...SOURCE, captured: [], done: [], events: [], missed: [] };

function ai(digest: string | null, status?: number) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: (p: Record<string, unknown>) => {
        calls.push(p);
        if (status) return Promise.reject({ status, message: 'x' });
        return Promise.resolve({
          parsed_output: { digest },
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 80 },
        });
      },
    },
  } as unknown as AIClient;
  return { client, calls };
}

const usage = (capped = false): UsageStore => ({
  price: async (_u, model) =>
    ({
      model,
      input_per_mtok: 1,
      output_per_mtok: 5,
      cache_read_per_mtok: 0.1,
      cache_write_per_mtok: 1.25,
      eur_rate: 0.9,
    }) as never,
  monthlyCapEur: async () => (capped ? 1 : null),
  monthToDateEur: async () => (capped ? 2 : 0),
  record: async () => {},
});

function store(dates: string[], sources: Record<string, DaySource>) {
  const saved: Record<string, { digest: string; item_ids: string[] }> = {};
  const asked: string[] = [];
  const s: DayDigestStore = {
    datesToBuild: async (_u, yesterday) => (asked.push(yesterday), dates),
    source: async (_u, d) => sources[d] ?? EMPTY,
    save: async (_u, d, row) => {
      saved[d] = row;
    },
  };
  return { s, saved, asked };
}

Deno.test(
  "yesterday's summary: one small call over its sources, saved with every item id",
  async () => {
    const st = store(['2026-11-17'], { '2026-11-17': SOURCE });
    const { client, calls } = ai(fx.output.digest);
    const res = await runDayDigests(USER, '2026-11-18', {
      store: st.s,
      ai: client,
      usage: usage(),
    });
    assertEquals(res, { built: ['2026-11-17'], failed: [] });
    assertEquals(st.asked, ['2026-11-17']);
    assertEquals(calls[0]?.model, 'claude-haiku-5-5');
    assertEquals((calls[0]?.system as { text: string }[])[0]?.text, DAY_DIGEST_SYSTEM);
    assertStringIncludes((calls[0]?.messages as { content: string }[])[0]?.content ?? '', '<day>');
    assertEquals(st.saved['2026-11-17']?.digest, fx.output.digest);
    assertEquals(st.saved['2026-11-17']?.item_ids.sort(), sourceIds(SOURCE).sort());
  },
);

Deno.test('a day with nothing gets "Nothing recorded." and no call', async () => {
  const st = store(['2026-11-17'], {});
  const { client, calls } = ai('x');
  await runDayDigests(USER, '2026-11-18', { store: st.s, ai: client, usage: usage() });
  assertEquals(calls.length, 0);
  assertEquals(st.saved['2026-11-17'], { digest: NOTHING_RECORDED, item_ids: [] });
  assertEquals(isEmptyDay(EMPTY), true);
});

Deno.test('stale days are rebuilt from sources; a failure waits for the next night', async () => {
  const st = store(['2026-11-17', '2026-11-10'], { '2026-11-17': SOURCE, '2026-11-10': SOURCE });
  const { client } = ai(null, 500);
  const res = await runDayDigests(USER, '2026-11-18', { store: st.s, ai: client, usage: usage() });
  assertEquals(res, { built: [], failed: ['2026-11-17', '2026-11-10'] });
  assertEquals(Object.keys(st.saved), []);
});

Deno.test('at the monthly cap the rest of the night stops', async () => {
  const st = store(['2026-11-17', '2026-11-10'], { '2026-11-17': SOURCE, '2026-11-10': SOURCE });
  const { client, calls } = ai('x');
  const res = await runDayDigests(USER, '2026-11-18', {
    store: st.s,
    ai: client,
    usage: usage(true),
  });
  assertEquals([res.failed, calls.length], [['2026-11-17'], 0]);
});

Deno.test('summaries are held to 120 words', () => {
  const long = Array.from({ length: 150 }, (_, i) => `w${i}`).join(' ');
  const out = clampWords(long);
  assertEquals(out.split(' ').length, 120);
  assertEquals(out.endsWith('…'), true);
  assertEquals(clampWords('  Short   one. '), 'Short one.');
});
