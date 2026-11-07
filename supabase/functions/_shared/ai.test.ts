import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { z } from 'npm:zod@4.6.7';
import { type AIClient, callAI, type UsageRow, type UsageStore } from './ai.ts';
import { costEur } from './prices.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const PRICE = {
  model: 'claude-haiku-5-5',
  input_per_mtok: 0.1,
  output_per_mtok: 0.5,
  cache_read_per_mtok: 0.01,
  cache_write_per_mtok: 0.125,
  eur_rate: 0.86,
};
const Schema = z.object({ items: z.array(z.object({ type: z.string(), title: z.string() })) });
const GOOD = { items: [{ type: 'task', title: 'Call Mark' }] };
const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 2000,
  cache_creation_input_tokens: 0,
};

type Step = { parsed_output: unknown; stop_reason?: string } | { throw: unknown };

function fakeClient(steps: Step[]) {
  const calls: Record<string, unknown>[] = [];
  const options: unknown[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>, opts?: unknown) => {
        calls.push(params);
        options.push(opts);
        const step = steps.shift();
        if (!step) throw new Error('unexpected extra call');
        if ('throw' in step) throw step.throw;
        return {
          parsed_output: step.parsed_output,
          stop_reason: step.stop_reason ?? 'end_turn',
          usage: USAGE,
        };
      },
    },
  } as unknown as AIClient;
  return { client, calls, options };
}

function fakeStore(opts: { cap?: number | null; spent?: number } = {}) {
  const rows: UsageRow[] = [];
  const store: UsageStore = {
    price: async () => PRICE,
    monthlyCapEur: async () => opts.cap ?? null,
    monthToDateEur: async () => opts.spent ?? 0,
    record: async (row) => {
      rows.push(row);
    },
  };
  return { store, rows };
}

const request = (background = true) => ({
  userId: USER,
  task: 'sort_batch',
  tier: 'small' as const,
  system: 'You sort captures.',
  messages: [{ role: 'user' as const, content: 'buy milk' }],
  schema: Schema,
  background,
});

Deno.test('cost: tokens × prices, cache reads at their own rate, converted to euros', () => {
  // (1200×0.1 + 300×0.5 + 2000×0.01) / 1e6 = 0.00029 USD × 0.86
  assertEquals(costEur(USAGE, PRICE), 0.000249);
});

Deno.test('success: returns the data and writes one ok usage row with the cost', async () => {
  const { client, calls } = fakeClient([{ parsed_output: GOOD }]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());

  assertEquals(result, { ok: true, data: GOOD, costEur: 0.000249 });
  assertEquals(rows.length, 1);
  assertEquals(rows[0], {
    user_id: USER,
    task: 'sort_batch',
    tier: 'small',
    model: 'claude-haiku-5-5',
    attempt: 1,
    input_tokens: 1200,
    output_tokens: 300,
    cache_read_tokens: 2000,
    cache_write_tokens: 0,
    cost_eur: 0.000249,
    ok: true,
    error_code: null,
  });
  // The request: small-tier model, cached system prompt, structured output format.
  const sent = calls[0] as {
    model: string;
    system: { text: string; cache_control: unknown }[];
    output_config: { format: { type: string } };
  };
  assertEquals(sent.model, 'claude-haiku-5-5');
  assertEquals(sent.system[0]?.cache_control, { type: 'ephemeral' });
  assertEquals(sent.output_config.format.type, 'json_schema');
});

Deno.test('invalid output then success: retries once, two usage rows', async () => {
  const { client } = fakeClient([{ parsed_output: { nope: true } }, { parsed_output: GOOD }]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());

  assert(result.ok);
  assertEquals(
    rows.map((r) => [r.attempt, r.ok, r.error_code]),
    [
      [1, false, 'invalid_output'],
      [2, true, null],
    ],
  );
});

Deno.test('unparseable JSON (SDK throws) counts as invalid output and is retried', async () => {
  const { client } = fakeClient([
    { throw: new SyntaxError('Unexpected token') },
    { parsed_output: GOOD },
  ]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());
  assert(result.ok);
  assertEquals(
    rows.map((r) => r.error_code),
    ['invalid_output', null],
  );
});

Deno.test('invalid twice: gives up with invalid_output after two rows', async () => {
  const { client } = fakeClient([{ parsed_output: null }, { parsed_output: { items: 'x' } }]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());

  assertEquals(result.ok, false);
  assert(!result.ok && result.error_code === 'invalid_output');
  assertEquals(
    rows.map((r) => [r.attempt, r.ok, r.error_code]),
    [
      [1, false, 'invalid_output'],
      [2, false, 'invalid_output'],
    ],
  );
});

Deno.test('API error: no retry, one api_error row, plain message', async () => {
  const apiError = Object.assign(new Error('Overloaded'), { status: 529 });
  const { client } = fakeClient([{ throw: apiError }]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());

  assert(!result.ok && result.error_code === 'api_error');
  assert(!result.ok && !result.message.includes('Overloaded'));
  assertEquals(
    rows.map((r) => [r.ok, r.error_code, r.input_tokens]),
    [[false, 'api_error', 0]],
  );
});

Deno.test('cap reached: nothing is sent, one cap_reached row', async () => {
  const { client, calls } = fakeClient([]);
  const { store, rows } = fakeStore({ cap: 5, spent: 5.01 });
  const result = await callAI({ client, store }, request(false));

  assertEquals(calls.length, 0);
  assert(!result.ok && result.error_code === 'cap_reached');
  assert(!result.ok && result.message.includes('AI limit'));
  assertEquals(
    rows.map((r) => [r.ok, r.error_code, r.cost_eur]),
    [[false, 'cap_reached', 0]],
  );
});

Deno.test('under the cap: the call goes ahead', async () => {
  const { client } = fakeClient([{ parsed_output: GOOD }]);
  const { store } = fakeStore({ cap: 5, spent: 4.99 });
  assert((await callAI({ client, store }, request())).ok);
});

Deno.test('refusal: recorded and returned, not retried', async () => {
  const { client, calls } = fakeClient([{ parsed_output: null, stop_reason: 'refusal' }]);
  const { store, rows } = fakeStore();
  const result = await callAI({ client, store }, request());
  assertEquals(calls.length, 1);
  assert(!result.ok && result.error_code === 'refused');
  assertEquals(
    rows.map((r) => r.error_code),
    ['refused'],
  );
});

Deno.test('large tier maps to the large model', async () => {
  const { client, calls } = fakeClient([{ parsed_output: GOOD }]);
  const { store } = fakeStore();
  await callAI({ client, store }, { ...request(), tier: 'large' });
  assertEquals((calls[0] as { model: string }).model, 'claude-sonnet-5-5');
});

Deno.test('several system blocks: each is a cache breakpoint, blank ones dropped', async () => {
  const { client, calls } = fakeClient([{ parsed_output: GOOD }]);
  const { store } = fakeStore();
  await callAI(
    { client, store },
    { ...request(), system: ['Fixed rules.', '', 'Profile: - Trains on Tuesdays'] },
  );
  const system = (calls[0] as { system: { text: string; cache_control: unknown }[] }).system;
  assertEquals(
    system.map((b) => b.text),
    ['Fixed rules.', 'Profile: - Trains on Tuesdays'],
  );
  assert(system.every((b) => JSON.stringify(b.cache_control) === '{"type":"ephemeral"}'));
});

Deno.test('large tier asks for the server-side refusal fallback; small tier does not', async () => {
  const large = fakeClient([{ parsed_output: GOOD }]);
  await callAI(
    { client: large.client, store: fakeStore().store },
    { ...request(false), tier: 'large' },
  );
  assertEquals(large.calls[0]?.fallbacks, 'default');
  assertEquals(large.options[0], {
    headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' },
  });

  const small = fakeClient([{ parsed_output: GOOD }]);
  await callAI({ client: small.client, store: fakeStore().store }, request(false));
  assertEquals(small.calls[0]?.fallbacks, undefined);
  assertEquals(small.options[0], undefined);
});
