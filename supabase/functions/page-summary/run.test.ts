import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fx from '../../../tests/fixtures/ai/page-summary.json' with { type: 'json' };
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { cleanFacts, type PageRow, type PageSummaryStore, runPageSummaries } from './run.ts';

const USER = '11111111-1111-4111-8111-111111111111';

function ai(output: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: (p: Record<string, unknown>) => {
        calls.push(p);
        return Promise.resolve({
          parsed_output: output,
          stop_reason: 'end_turn',
          usage: { input_tokens: 600, output_tokens: 150 },
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

function store(pages: PageRow[]) {
  const since: (string | null)[] = [];
  const saved: Record<string, { summary: string; facts: unknown[] }> = {};
  const s: PageSummaryStore = {
    due: async () => pages,
    items: async (_p, s) => (since.push(s), fx.items),
    save: async (id, row) => {
      saved[id] = row;
    },
  };
  return { s, since, saved };
}

const page = fx.page as PageRow;

Deno.test('a new page is summarised from every item; its facts are kept', async () => {
  const st = store([page]);
  const { client, calls } = ai(fx.output);
  const res = await runPageSummaries(USER, { store: st.s, ai: client, usage });
  assertEquals(res, { built: [page.id], failed: [] });
  assertEquals(st.since, [null]);
  const msg = (calls[0]?.messages as { content: string }[])[0]?.content ?? '';
  assertStringIncludes(msg, '<page>');
  assertStringIncludes(msg, 'Brought boots');
  assertEquals(st.saved[page.id]?.summary, fx.output.summary);
  assertEquals(st.saved[page.id]?.facts.length, 2);
});

Deno.test('a changed page sends its summary and only items changed since', async () => {
  const st = store([
    {
      ...page,
      summary: 'Weekly training.',
      facts: [{ date: '2026-11-04', text: 'Old fact' }],
      summarised_at: '2026-11-12T03:30:00Z',
    },
  ]);
  const { client, calls } = ai(fx.output);
  await runPageSummaries(USER, { store: st.s, ai: client, usage });
  assertEquals(st.since, ['2026-11-12T03:30:00Z']);
  assertStringIncludes(
    (calls[0]?.messages as { content: string }[])[0]?.content ?? '',
    'Weekly training.',
  );
});

Deno.test('a rebuild starts from every item and an empty summary', async () => {
  const st = store([
    {
      ...page,
      summary: 'Wrong.',
      summarised_at: '2026-11-12T03:30:00Z',
      rebuild_requested_at: '2026-11-16T10:00:00Z',
    },
  ]);
  const { client, calls } = ai(fx.output);
  await runPageSummaries(USER, { store: st.s, ai: client, usage });
  assertEquals(st.since, [null]);
  assertEquals(
    ((calls[0]?.messages as { content: string }[])[0]?.content ?? '').includes('Wrong.'),
    false,
  );
});

Deno.test('facts: dated, tidied, newest first, at most 8', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    text: ` fact  ${i} `,
  }));
  const out = cleanFacts([
    ...many,
    { date: 'soon', text: 'no date' },
    { date: '2026-01-01', text: ' ' },
  ]);
  assertEquals(out.length, 8);
  assertEquals(out[0], { date: '2026-11-10', text: 'fact 9' });
});
