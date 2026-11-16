import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fx from '../../../tests/fixtures/ai/plan-evening.json' with { type: 'json' };
import type { AIClient, UsageRow, UsageStore } from '../_shared/ai.ts';
import { PLAN_SYSTEM } from '../_shared/prompts/plan.v2.ts';
import type { RawPlanDigest } from './digest.ts';
import { runPlanDay, type PlanStore } from './run.ts';
import type { ApplyPayload } from './validate.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date(fx.now);
const RAW = fx.raw as unknown as RawPlanDigest;

function ai(output: unknown, opts: { throwStatus?: number } = {}) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: (params: Record<string, unknown>) => {
        calls.push(params);
        if (opts.throwStatus) return Promise.reject({ status: opts.throwStatus, message: 'x' });
        return Promise.resolve({
          parsed_output: output,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 2000,
            output_tokens: 400,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      },
    },
  } as unknown as AIClient;
  return { client, calls };
}

function usage() {
  const rows: UsageRow[] = [];
  const store: UsageStore = {
    price: () =>
      Promise.resolve({
        input_per_mtok: 1,
        output_per_mtok: 5,
        cache_read_per_mtok: 0.1,
        cache_write_per_mtok: 1.25,
        eur_rate: 0.9,
      } as never),
    monthlyCapEur: () => Promise.resolve(null),
    monthToDateEur: () => Promise.resolve(0),
    record: (r) => {
      rows.push(r);
      return Promise.resolve();
    },
  };
  return { store, rows };
}

function store(over: Partial<PlanStore> = {}) {
  const log: string[] = [];
  let applied: (ApplyPayload & { cost_eur: number; summary: Record<string, unknown> }) | null =
    null;
  const s: PlanStore = {
    startRun: (_u, kind, date) => {
      log.push(`start ${kind} ${date}`);
      return Promise.resolve('run-1');
    },
    settings: () => Promise.resolve({ time_zone: 'Europe/Dublin' }),
    profile: () => Promise.resolve('Trains at the gym on Wednesdays.'),
    digest: () => Promise.resolve(RAW),
    spentToday: () => Promise.resolve(0),
    apply: (_r, p) => {
      applied = p as typeof applied;
      log.push('apply');
      return Promise.resolve(p.nudges.length);
    },
    finish: (_r, status, f) => {
      log.push(`finish ${status}${f.error ? ` ${f.error}` : ''}`);
      return Promise.resolve();
    },
    ...over,
  };
  return { s, log, applied: () => applied };
}

const deps = (s: PlanStore, client: AIClient) => ({ store: s, ai: client, usage: usage().store });

Deno.test(
  'the evening run plans tomorrow: the bag the evening before, leave before, do at the due time',
  async () => {
    const st = store();
    const { client, calls } = ai(fx.output);
    const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
    assertEquals(res, { status: 'ok', nudges_written: 3, dropped: 0 });
    assertEquals(st.log, ['start evening 2026-11-17', 'apply']);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.model, 'claude-haiku-5-5');
    const system = calls[0]?.system as { text: string }[];
    assertEquals(system[0]?.text, PLAN_SYSTEM);
    assertStringIncludes(system[1]?.text ?? '', 'Trains at the gym');
    const msg = (calls[0]?.messages as { content: string }[])[0]?.content ?? '';
    assertStringIncludes(msg, '<digest>');
    assertStringIncludes(msg, 'Training');

    const p = st.applied();
    assert(p);
    assertEquals(
      p.nudges.map((n) => [n.kind, n.send_at]),
      [
        ['prepare', '2026-11-17T20:30:00.000Z'],
        ['leave', '2026-11-18T07:30:00.000Z'],
        ['do', '2026-11-18T15:00:00.000Z'],
      ],
    );
    assertEquals(
      p.items.map((i) => i.prep.length),
      [3, 0],
    );
    assert(p.cost_eur > 0);
    assertEquals(p.summary.tonight, ['Pack your training bag']);
    assertEquals(p.summary.prompt, 'plan.v2');
  },
);

Deno.test('a run that already happened today does nothing', async () => {
  const st = store({ startRun: () => Promise.resolve(null) });
  const { client, calls } = ai(fx.output);
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals([res.status, calls.length], ['already_ran', 0]);
});

Deno.test('the daily planning cap: no call, cap_reached, defaults stand', async () => {
  const st = store({ spentToday: () => Promise.resolve(0.15) });
  const { client, calls } = ai(fx.output);
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals([res.status, calls.length], ['cap_reached', 0]);
  assertEquals(st.log.at(-1), 'finish cap_reached');
});

Deno.test('the planner switched off: skipped, no call', async () => {
  const st = store({ settings: () => Promise.resolve({ plan: { enabled: false } }) });
  const { client, calls } = ai(fx.output);
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals([res.status, calls.length], ['skipped', 0]);
});

Deno.test('a day with nothing on: an empty plan, no AI call, no nudges', async () => {
  const st = store({ digest: () => Promise.resolve({ ...RAW, items: [], nudges: [] }) });
  const { client, calls } = ai(fx.output);
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals([res.status, res.nudges_written, calls.length], ['ok', 0, 0]);
});

Deno.test('an API failure closes the run as failed', async () => {
  const st = store();
  const { client } = ai(null, { throwStatus: 500 });
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals(res.status, 'failed');
  assertEquals(st.log.at(-1), 'finish failed api_error');
});

Deno.test('a store failure mid-run closes the run as failed with the reason', async () => {
  const st = store({ digest: () => Promise.reject(new Error('digest: boom')) });
  const { client } = ai(fx.output);
  const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
  assertEquals(res.status, 'failed');
  assertEquals(st.log.at(-1), 'finish failed digest: boom');
});

Deno.test(
  'history: recent summaries go in the message ahead of the digest (Task 14.8)',
  async () => {
    const st = store({
      history: () =>
        Promise.resolve({
          days: [{ date: '2026-11-16', digest: 'Packed boots for training.' }],
          weeks: [{ week_start: '2026-11-09', digest: 'Busy week.' }],
          month: { month: '2026-10-01', digest: 'October.' },
        }),
    });
    const { client, calls } = ai(fx.output);
    await runPlanDay(USER, '2026-11-17', NOW, 'evening', deps(st.s, client));
    const msg = (calls[0]?.messages as { content: string }[])[0]?.content ?? '';
    assertStringIncludes(msg, '<history>');
    assertStringIncludes(msg, 'Packed boots for training.');
    assert(msg.indexOf('<history>') < msg.indexOf('<digest>'));
  },
);

Deno.test(
  'look-ups: offered as tools, and how many were used is recorded (Task 14.8)',
  async () => {
    const st = store();
    const { client, calls } = ai(fx.output);
    const res = await runPlanDay(USER, '2026-11-17', NOW, 'evening', {
      ...deps(st.s, client),
      lookups: {
        search_history: {
          description: 'Search',
          input_schema: { type: 'object', properties: {} },
          run: () => Promise.resolve([]),
        },
      },
    });
    assertEquals(res.status, 'ok');
    assertEquals(
      (calls[0]?.tools as { name: string }[] | undefined)?.map((t) => t.name),
      ['search_history'],
    );
    assertEquals((st.applied() as unknown as { lookups_used: number }).lookups_used, 0);
  },
);
