import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import {
  contradicts,
  findPatterns,
  type LivePref,
  type Outcome,
  runTimingPrefs,
  type TimingStore,
} from './timing.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const day = (n: number, h: number) =>
  `2026-11-${String(n).padStart(2, '0')}T${String(h).padStart(2, '0')}:30:00.000Z`;

function bag(n: number, outcome: Outcome['outcome'], movedTo: number | null): Outcome {
  return {
    kind: 'prepare',
    page_id: 'p-training',
    page_name: 'Training',
    outcome,
    send_at: day(n, 20),
    snoozed_to: movedTo === null ? null : day(n + 1, movedTo),
    outcome_at: day(n, 21),
  };
}

// Three morning snoozes of the bag nudge out of the last five.
const SNOOZED = [
  bag(1, 'acted', null),
  bag(3, 'snoozed', 7),
  bag(5, 'snoozed', 7),
  bag(8, 'ignored', null),
  bag(10, 'snoozed', 6),
];

Deno.test('the pattern rule: 3 snoozes the same way out of the last 5, per kind and page', () => {
  const [p, ...rest] = findPatterns(SNOOZED);
  assertEquals(rest, []);
  assertEquals(
    [p?.kind, p?.page_name, p?.direction, p?.shift_minutes],
    ['prepare', 'Training', 'later', 660],
  );
  assertEquals(findPatterns(SNOOZED.slice(0, 3)), []);
  // Older snoozes fall out of the last five.
  assertEquals(
    findPatterns([
      ...SNOOZED,
      bag(12, 'acted', null),
      bag(14, 'acted', null),
      bag(16, 'acted', null),
    ]),
    [],
  );
});

Deno.test('acting as sent, or snoozing the other way, contradicts a preference', () => {
  assertEquals(contradicts(bag(20, 'acted', null), { direction: 'later' }), true);
  assertEquals(contradicts(bag(20, 'snoozed', 7), { direction: 'later' }), false);
  assertEquals(contradicts(bag(20, 'ignored', null), { direction: 'later' }), false);
});

function fakes(outcomes: Outcome[], live: LivePref[] = []) {
  const learned: string[] = [];
  const contradicted: [number, boolean][] = [];
  const store: TimingStore = {
    outcomes: async () => outcomes,
    live: async () => live,
    learn: async (_u, _p, fact) => {
      learned.push(fact);
    },
    contradict: async (_p, count, _until, archive) => {
      contradicted.push([count, archive]);
    },
  };
  const calls: Record<string, unknown>[] = [];
  const ai = {
    messages: {
      parse: (p: Record<string, unknown>) => {
        calls.push(p);
        return Promise.resolve({
          parsed_output: { fact: 'Packs the training bag in the morning, not the evening before' },
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 20 },
        });
      },
    },
  } as unknown as AIClient;
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
  return { store, ai, usage, learned, contradicted, calls };
}

Deno.test('a new pattern is worded in one small call and saved as a fact', async () => {
  const f = fakes(SNOOZED);
  const r = await runTimingPrefs(USER, new Date('2026-11-12T03:40:00Z'), f);
  assertEquals(r, { learned: 1, archived: 0 });
  assertEquals(f.learned, ['Packs the training bag in the morning, not the evening before']);
  assertStringIncludes(
    (f.calls[0]?.messages as { content: string }[])[0]?.content ?? '',
    '"direction":"later"',
  );
});

Deno.test('a known preference is not learned again; 3 contradictions archive it', async () => {
  const pref: LivePref = {
    id: 'tp1',
    kind: 'prepare',
    page_id: 'p-training',
    direction: 'later',
    fact_id: 'f1',
    contradictions: 1,
    checked_until: day(11, 0),
  };
  const f = fakes([...SNOOZED, bag(12, 'acted', null), bag(14, 'acted', null)], [pref]);
  const r = await runTimingPrefs(USER, new Date('2026-11-15T03:40:00Z'), f);
  assertEquals(r, { learned: 0, archived: 1 });
  assertEquals(f.contradicted, [[3, true]]);
  assertEquals(f.calls.length, 0);
});
