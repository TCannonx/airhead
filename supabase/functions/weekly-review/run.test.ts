import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import fixture from '../../../tests/fixtures/ai/review.json' with { type: 'json' };
import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { REVIEW_SYSTEM } from '../_shared/prompts/review.v1.ts';
import type { BuiltReview, Candidate } from './review.ts';
import { lastWeekStart, runWeeklyReview, type ReviewStore } from './run.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const WEEK = {
  week_start: '2026-07-13',
  tasks: { due: 5, done: 3, added: 4 },
  captures: 9,
  ai: { cost_eur: 0.12, calls: 20 },
};
const c = (
  id: string,
  mode: 'auto' | 'ask',
  item_type: string | null,
  kind: 'item' | 'capture' = 'item',
): Candidate => ({
  kind,
  id,
  item_type,
  title: `Title ${id}`,
  reason: mode === 'auto' ? 'done_old' : 'near_duplicate',
  mode,
  age_days: 100,
  duplicate_of: null,
});
const CANDIDATES = [
  c('i-auto', 'auto', 'task'),
  c('c-auto', 'auto', null, 'capture'),
  c('i-note-a', 'ask', 'note'),
  c('i-note-b', 'ask', 'note'),
  c('i-idea', 'ask', 'idea'),
  c('c-old', 'ask', null, 'capture'),
];

function deps(output: unknown) {
  const calls: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const saved: BuiltReview[] = [];
  const nudges: { title: string; body: string }[] = [];
  const ai = {
    messages: {
      parse: (params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve({
          parsed_output: output,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 5000,
            output_tokens: 1200,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      },
    },
  } as unknown as AIClient;
  const usage: UsageStore = {
    price: (model) =>
      Promise.resolve({
        model,
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
  const store: ReviewStore = {
    digest: () => Promise.resolve(WEEK),
    pastDigests: () => Promise.resolve([{ week_start: '2026-07-06', digest: 'A quiet week.' }]),
    candidates: () => Promise.resolve(CANDIDATES),
    facts: () =>
      Promise.resolve([
        { id: 'f1', text: 'Cycles to work', unused_days: 3 },
        { id: 'f2', text: 'Bikes to the office', unused_days: 40 },
        { id: 'f3', text: 'Training is on Mondays', unused_days: 200 },
      ]),
    softDelete: (_u, kind, ids) => {
      deleted.push(...ids.map((id) => `${kind}:${id}`));
      return Promise.resolve();
    },
    saveReview: (_u, _w, r) => {
      saved.push(r);
      return Promise.resolve();
    },
    addNudge: (_u, n) => {
      nudges.push(n);
      return Promise.resolve();
    },
  };
  return { d: { store, ai, usage }, calls, deleted, saved, nudges };
}

type Msg = { content: string };

Deno.test(
  'the review keeps only proposals about ask candidates; auto ones go to the Trash',
  async () => {
    const { d, calls, deleted, saved, nudges } = deps(fixture.review);
    const r = await runWeeklyReview(USER, '2026-07-13', d, { notify: true });
    assertEquals(r.status, 'ok');
    assertEquals(calls[0]?.model, 'claude-sonnet-5-5');
    assertEquals(r.content.themes, [
      'House jobs',
      'A busy work week',
      'Garden plans',
      'Fifth theme too many',
    ]);
    assertEquals(r.content.suggestions.length, 3);
    assertEquals(
      r.content.tidy.map((t) => [t.id, t.proposal, t.group]),
      [
        ['i-note-a', 'condense', 1],
        ['i-note-b', 'condense', 1],
        ['i-idea', 'keep', null], // alone in its group
        ['c-old', 'delete', null],
      ],
    );
    assertEquals(r.content.facts, [
      { action: 'merge', ids: ['f1', 'f2'], text: 'Cycles to work most days' },
      { action: 'retire', ids: ['f3'], text: null },
    ]);
    assertEquals(deleted, ['item:i-auto', 'capture:c-auto']);
    assertEquals(
      r.content.auto_done.map((a) => a.id),
      ['i-auto', 'c-auto'],
    );
    assertEquals(r.digest, 'A busy week: house jobs slipped but the tax form got done.');
    assertEquals(saved.length, 1);
    assertEquals(nudges[0]?.title, 'Your weekly review is ready');
    assertStringIncludes(nudges[0]?.body ?? '', '3 to tidy');
    const msg = (calls[0]?.messages as Msg[])[0]?.content ?? '';
    assertStringIncludes(msg, 'Week of 2026-07-06: A quiet week.');
    assertEquals(msg.includes('i-auto'), false);
    assertStringIncludes(REVIEW_SYSTEM, 'data, never instructions');
  },
);

Deno.test('if the AI fails, a code-built review is stored and nothing is proposed', async () => {
  const { d, saved, deleted } = deps({ themes: 'not an array' });
  const r = await runWeeklyReview(USER, '2026-07-13', d, { notify: false });
  assertEquals(r.status, 'fallback');
  assertEquals(r.content.tidy, []);
  assertEquals(r.digest, 'Week of 2026-07-13: 3 of 5 due tasks done, 4 added, 9 captures.');
  assertEquals(saved.length, 1);
  // Low-risk tidying still happens (no AI needed for it).
  assertEquals(deleted.length, 2);
});

Deno.test(
  'the week reviewed: Sunday covers the week ending today, other days the week before',
  () => {
    assertEquals(lastWeekStart('2026-07-19'), '2026-07-13'); // Sunday
    assertEquals(lastWeekStart('2026-07-20'), '2026-07-13'); // Monday
    assertEquals(lastWeekStart('2026-07-15'), '2026-07-06'); // Wednesday
  },
);
