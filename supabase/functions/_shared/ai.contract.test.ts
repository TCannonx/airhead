// The AI call path end to end, without the paid API: the real Anthropic SDK,
// the real sorting prompt and schema, against tests/mock-ai (which rejects
// schemas the real API would reject). Catches a request the API would refuse
// before it ships (2026-11-08: every sorting call was rejected on dev).
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { z } from 'npm:zod@4.6.7';
import { createMockServer } from '../../../tests/mock-ai/server.mjs';
import { type CallAIRequest, callAI, type UsageStore } from './ai.ts';
import { anthropicClient } from './anthropic.ts';
import { buildSortMessage, SORT_BATCH_SYSTEM } from './prompts/sort-batch.v4.ts';
import { readAction, SortResult } from './schemas/sort.ts';

const rows: { ok: boolean; error_code: string | null }[] = [];
const store: UsageStore = {
  monthlyCapEur: async () => null,
  monthToDateEur: async () => 0,
  price: async () => ({ input: 1, output: 1, cache_read: 0, cache_write: 0 }) as never,
  record: async (r) => {
    rows.push({ ok: r.ok, error_code: r.error_code });
  },
};

async function withMock(run: (url: string) => Promise<void>) {
  const server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const request = <T>(schema: z.ZodType<T>, system: string, content: string): CallAIRequest<T> => ({
  userId: 'u1',
  task: 'sort_batch',
  tier: 'small',
  system: [system],
  messages: [{ role: 'user', content }],
  schema,
  background: false,
});

Deno.test('sorting: the real request is accepted and the answer parses into actions', async () => {
  await withMock(async (url) => {
    Deno.env.set('ANTHROPIC_BASE_URL', url);
    try {
      const message = buildSortMessage(
        {
          now: new Date().toISOString(),
          timeZone: 'Europe/Dublin',
          topics: [],
          lists: [],
          ideas: [],
          corrections: [],
          candidates: [],
        },
        [
          { id: 'c1', text: 'I have 9.5 days annual leave left', url: null },
          { id: 'c2', text: 'buy milk', url: null },
        ],
      );
      const r = await callAI(
        { client: anthropicClient('test-key'), store },
        request(SortResult, SORT_BATCH_SYSTEM, message),
      );
      assert(r.ok, `sorting call failed: ${JSON.stringify(r)}`);
      const [first, second] = r.data.results;
      assertEquals(readAction(first!.actions[0]!).days, 9.5);
      assertEquals(second!.items[0]!.title, 'Buy milk');
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
    }
  });
});

Deno.test('a schema the real API would refuse fails here too', async () => {
  await withMock(async (url) => {
    Deno.env.set('ANTHROPIC_BASE_URL', url);
    try {
      const big = z.object(
        Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, z.string().nullable()])),
      );
      rows.length = 0;
      const r = await callAI(
        { client: anthropicClient('test-key'), store },
        request(big, SORT_BATCH_SYSTEM, 'x'),
      );
      assertEquals(r.ok, false);
      assertEquals(rows.at(-1)?.error_code, 'api_error');
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
    }
  });
});

Deno.test(
  'sorting: a longer note with an instant event comes back tidied, plus what it lost',
  async () => {
    await withMock(async (url) => {
      Deno.env.set('ANTHROPIC_BASE_URL', url);
      try {
        const message = buildSortMessage(
          {
            now: new Date().toISOString(),
            timeZone: 'Europe/Dublin',
            topics: [],
            lists: [],
            ideas: [],
            corrections: [],
            candidates: [],
          },
          [
            {
              id: 'c1',
              text: 'Training on Tuesday. Need a reminder to send report to Trevor',
              url: null,
              instant: {
                title: 'Training . Need a reminder to send report to Trevor',
                start: '2030-11-12T00:00:00.000Z',
                all_day: true,
              },
            },
          ],
        );
        const r = await callAI(
          { client: anthropicClient('test-key'), store },
          request(SortResult, SORT_BATCH_SYSTEM, message),
        );
        assert(r.ok, `sorting call failed: ${JSON.stringify(r)}`);
        assertEquals(
          r.data.results[0]!.items.map((i) => [i.type, i.title, i.start_at]),
          [
            ['event', 'Training', '2030-11-12T00:00:00.000Z'],
            ['task', 'Send report to Trevor', null],
          ],
        );
      } finally {
        Deno.env.delete('ANTHROPIC_BASE_URL');
      }
    });
  },
);
