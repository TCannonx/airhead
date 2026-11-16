import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fx from '../../../tests/fixtures/ai/link-enrich.json' with { type: 'json' };
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { enrichLink, unreadableReason } from './enrich.ts';
import type { LinkInfo } from './extract.ts';

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
          usage: { input_tokens: 900, output_tokens: 200 },
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

const read: LinkInfo = {
  status: 'read',
  title: fx.page.title,
  description: 'A plan',
  word_count: 3000,
  reading_minutes: 13,
  text: fx.page.text,
};

Deno.test('a readable page: one small call, the page as data, minutes from code', async () => {
  const { client, calls } = ai(fx.output);
  const link = await enrichLink(
    { ai: client, usage },
    {
      userId: USER,
      url: 'https://www.example.com/x',
      note: fx.note,
      info: read,
      fetched: { status: 'ok' },
    },
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.model, 'claude-haiku-5-5');
  const msg = (calls[0]?.messages as { content: string }[])[0]?.content ?? '';
  assertStringIncludes(msg, '<page title="A 16-week marathon plan');
  assertStringIncludes(msg, '<note>\nfor the spring marathon');
  assertEquals(
    [link.status, link.kind, link.minutes, link.source],
    ['read', 'article', 13, 'example.com'],
  );
  assertEquals(link.why_saved, fx.output.why_saved);
});

Deno.test('no words around the link: why_saved stays empty', async () => {
  const { client } = ai(fx.output);
  const link = await enrichLink(
    { ai: client, usage },
    { userId: USER, url: 'https://e.example', note: '  ', info: read, fetched: { status: 'ok' } },
  );
  assertEquals(link.why_saved, '');
});

Deno.test('lists are trimmed: 5 key points, 3 topics, 5 mentions', async () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
  const { client } = ai({
    ...fx.output,
    key_points: many(8),
    topics: ['A', 'A', 'B', 'C', 'D'],
    mentions: many(7).map((name) => ({ kind: 'tool', name })),
  });
  const link = await enrichLink(
    { ai: client, usage },
    { userId: USER, url: 'https://e.example', note: '', info: read, fetched: { status: 'ok' } },
  );
  assertEquals(
    [link.key_points.length, link.topics, link.mentions.length],
    [5, ['A', 'B', 'C'], 5],
  );
});

Deno.test('an unreadable page keeps what is known, says why, and makes no call', async () => {
  const { client, calls } = ai(fx.output);
  const info: LinkInfo = {
    status: 'unreadable',
    title: 'Members only',
    description: null,
    word_count: 0,
    reading_minutes: null,
    text: null,
  };
  const link = await enrichLink(
    { ai: client, usage },
    {
      userId: USER,
      url: 'https://paper.example/a',
      note: '',
      info,
      fetched: { status: 'error', reason: 'HTTP 403' },
    },
  );
  assertEquals(calls.length, 0);
  assertEquals(
    [link.status, link.reason, link.title, link.source],
    ['unreadable', 'needs sign-in', 'Members only', 'paper.example'],
  );
});

Deno.test('reasons in plain words', () => {
  const none = {
    status: 'unreadable',
    title: null,
    description: null,
    word_count: 0,
    reading_minutes: null,
    text: null,
  } as LinkInfo;
  assertEquals(
    [
      unreadableReason({ status: 'error', reason: 'HTTP 404' }, none),
      unreadableReason({ status: 'too_large', reason: 'over 2 MB' }, none),
      unreadableReason({ status: 'blocked', reason: 'address not allowed' }, none),
      unreadableReason({ status: 'error', reason: 'could not connect' }, none),
      unreadableReason({ status: 'ok' }, none),
    ],
    ['not found', 'too large', 'blocked', 'timed out', 'needs sign-in'],
  );
});
