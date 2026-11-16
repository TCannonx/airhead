import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fx from '../../../tests/fixtures/ai/month-digest.json' with { type: 'json' };
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { type MonthDigestStore, previousMonth, runMonthDigests, type WeekDigest } from './month.ts';
import { NOTHING_RECORDED } from './run.ts';

const USER = '11111111-1111-4111-8111-111111111111';

function ai(digest: string) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: (p: Record<string, unknown>) => {
        calls.push(p);
        return Promise.resolve({
          parsed_output: { digest },
          stop_reason: 'end_turn',
          usage: { input_tokens: 400, output_tokens: 90 },
        });
      },
    },
  } as unknown as AIClient;
  return { client, calls };
}

const usage: UsageStore = {
  price: async (_u, model) =>
    ({
      model,
      input_per_mtok: 1,
      output_per_mtok: 5,
      cache_read_per_mtok: 0.1,
      cache_write_per_mtok: 1.25,
      eur_rate: 0.9,
    }) as never,
  monthlyCapEur: async () => null,
  monthToDateEur: async () => 0,
  record: async () => {},
};

function store(months: string[], weeks: Record<string, WeekDigest[]>) {
  const saved: Record<string, { digest: string; week_starts: string[] }> = {};
  const asked: string[] = [];
  const s: MonthDigestStore = {
    monthsToBuild: async (_u, last) => (asked.push(last), months),
    weeks: async (_u, m) => weeks[m] ?? [],
    save: async (_u, m, row) => {
      saved[m] = row;
    },
  };
  return { s, saved, asked };
}

Deno.test("last month's summary comes from its weekly digests in one small call", async () => {
  const st = store(['2026-11-01'], { '2026-11-01': fx.weeks });
  const { client, calls } = ai(fx.output.digest);
  const res = await runMonthDigests(USER, '2026-12-01', { store: st.s, ai: client, usage });
  assertEquals(res, { built: ['2026-11-01'], failed: [] });
  assertEquals(st.asked, ['2026-11-01']);
  assertEquals(calls[0]?.model, 'claude-haiku-5-5');
  assertStringIncludes(
    (calls[0]?.messages as { content: string }[])[0]?.content ?? '',
    '<month start="2026-11-01">',
  );
  assertEquals(st.saved['2026-11-01'], {
    digest: fx.output.digest,
    week_starts: ['2026-11-02', '2026-11-09'],
  });
});

Deno.test('a month with no weekly digests gets "Nothing recorded." and no call', async () => {
  const st = store(['2026-11-01'], { '2026-11-01': [{ week_start: '2026-11-02', digest: ' ' }] });
  const { client, calls } = ai('x');
  await runMonthDigests(USER, '2026-12-01', { store: st.s, ai: client, usage });
  assertEquals(calls.length, 0);
  assertEquals(st.saved['2026-11-01'], { digest: NOTHING_RECORDED, week_starts: [] });
});

Deno.test('the month before: across a year end', () => {
  assertEquals(previousMonth('2027-01-01'), '2026-12-01');
  assertEquals(previousMonth('2026-11-16'), '2026-10-01');
});
