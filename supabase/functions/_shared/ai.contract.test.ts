// The AI call path end to end, without the paid API: the real Anthropic SDK,
// each function's real prompt and schema (sorting first, then every other AI
// call and Scout's web search), against tests/mock-ai (which rejects schemas
// the real API would reject). Catches a request the API would refuse
// before it ships (2026-11-08: every sorting call was rejected on dev).
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.6.0/helpers/zod';
import { z } from 'npm:zod@4.6.7';
import askFixture from '../../../tests/fixtures/ai/ask.json' with { type: 'json' };
import contradictionsFixture from '../../../tests/fixtures/ai/contradictions.json' with { type: 'json' };
import importFixture from '../../../tests/fixtures/ai/import-screenshot.json' with { type: 'json' };
import summariseFixture from '../../../tests/fixtures/ai/summarise.json' with { type: 'json' };
import workshopFixture from '../../../tests/fixtures/ai/workshop.json' with { type: 'json' };
import digestFixture from '../../../tests/fixtures/brief/digest.json' with { type: 'json' };
import { createMockServer, schemaMismatch, TASKS } from '../../../tests/mock-ai/server.mjs';
import { AskResult, runAsk } from '../ask/run.ts';
import { ContradictionsResult, validConflicts } from '../check-contradictions/check.ts';
import { ImportResult } from '../import-extract/extract.ts';
import { runImport } from '../import-extract/run.ts';
import { BriefResult, buildBrief, type Digest } from '../morning-brief/brief.ts';
import { scoutWeb } from '../scout/web.ts';
import { runSummarise, SummaryResult } from '../summarise-note/run.ts';
import { LeaveResult, runSuggestLeave } from '../suggest-leave/run.ts';
import { buildReview, ReviewResult } from '../weekly-review/review.ts';
import {
  DraftContent,
  type DraftContentT,
  runFleshOut,
  type WorkshopDeps,
} from '../workshop/run.ts';
import { runTurn, type Turn, TurnResult } from '../workshop/turn.ts';
import { type AIClient, type CallAIRequest, callAI, type UsageStore } from './ai.ts';
import { anthropicClient } from './anthropic.ts';
import { buildContradictionsMessage, CONTRADICTIONS_SYSTEM } from './prompts/contradictions.v1.ts';
import { buildSortMessage, SORT_BATCH_SYSTEM } from './prompts/sort-batch.v7.ts';
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

Deno.test('sorting: a note block comes back as a task for that note, with a digest', async () => {
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
        [],
        [{ id: 'n1', title: 'Note', text: 'need to send the report to Trevor by Friday' }],
      );
      const r = await callAI(
        { client: anthropicClient('test-key'), store },
        request(SortResult, SORT_BATCH_SYSTEM, message),
      );
      assert(r.ok, `sorting call failed: ${JSON.stringify(r)}`);
      const [note] = r.data.results;
      assertEquals(note!.capture_id, 'note:n1');
      assertEquals(
        note!.items.map((i) => [i.type, i.title]),
        [['task', 'Send the report to Trevor']],
      );
      assert(note!.items[0]!.due_at);
      assertEquals(r.data.digest, 'Noted from their notes: Send the report to Trevor.');
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
    }
  });
});

Deno.test(
  'sorting: a placeholder comes back as an event, a planning task and questions; vague words map to nothing; an answer is understood',
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
              text: 'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
              url: null,
            },
            { id: 'c2', text: 'hmm the thing with the stuff', url: null },
            {
              id: 'c3',
              text: 'the office team',
              url: null,
              answer: {
                question: 'Who are the sandwiches for?',
                about: 'Christmas sandwiches | event | ',
                final: false,
              },
            },
          ],
        );
        const r = await callAI(
          { client: anthropicClient('test-key'), store },
          request(SortResult, SORT_BATCH_SYSTEM, message),
        );
        assert(r.ok, `sorting call failed: ${JSON.stringify(r)}`);
        const [plan, vague, answer] = r.data.results;
        // Phase 12: the planning is taken forward, with specific questions.
        assertEquals(
          plan!.items.map((i) => [i.type, i.title, i.rrule, i.steps.length > 0]),
          [
            ['event', 'Christmas sandwiches', 'FREQ=WEEKLY;BYDAY=FR', false],
            ['task', 'Plan Christmas sandwiches', null, true],
          ],
        );
        assertEquals(plan!.leftover, null);
        assertEquals(
          plan!.follow_ups.map((f) => [f.question, f.about_item]),
          [
            ['Who are the sandwiches for?', 0],
            ['How many people?', 0],
            ['Making them or ordering?', 0],
          ],
        );
        assertEquals([vague!.items, vague!.actions, vague!.leftover], [[], [], null]);
        assertEquals(vague!.follow_ups, []);
        // An answer (Task 12.2) comes back as the next step it implies.
        assertEquals(
          answer!.items.map((i) => [i.type, i.title]),
          [['task', 'Sandwiches for the office team']],
        );
      } finally {
        Deno.env.delete('ANTHROPIC_BASE_URL');
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Every other AI call (TEST-MATRIX gap 2): each function's own code builds the
// real prompt and schema, the real SDK sends it to tests/mock-ai, the stand-in
// answers from tests/fixtures/ai (after checking the answer fits the schema the
// request sent), and the function's own parser and clean-up read the answer.
// ---------------------------------------------------------------------------

const usage: UsageStore = {
  monthlyCapEur: async () => null,
  monthToDateEur: async () => 0,
  price: async (_user, model) => ({
    model,
    input_per_mtok: 1,
    output_per_mtok: 5,
    cache_read_per_mtok: 0.1,
    cache_write_per_mtok: 1.25,
    eur_rate: 0.86,
  }),
  record: async (r) => {
    rows.push({ ok: r.ok, error_code: r.error_code });
  },
};

/** The client every function builds (`anthropicClient`), pointed at the stand-in. */
async function viaMock(run: (ai: AIClient) => Promise<void>) {
  await withMock(async (url) => {
    Deno.env.set('ANTHROPIC_BASE_URL', url);
    rows.length = 0;
    try {
      await run(anthropicClient('test-key'));
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
    }
  });
}

const USER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';

Deno.test('ask: the real request is accepted and only real citations are kept', async () => {
  await viaMock(async (ai) => {
    const res = await runAsk('What happened to the travel budget?', USER, {
      ai,
      store: usage,
      embed: async () => [0.1, 0.2],
      search: async () => askFixture.passages,
      items: async (ids) =>
        new Map(
          ids
            .filter((id) => id !== 'i-gone')
            .map((id) => [
              id,
              { title: id === 'i-budget' ? 'Budget review' : 'Odd', type: 'meeting' },
            ]),
        ),
      tier: async () => 'small',
    });
    assert(res.ok, JSON.stringify(res));
    assertEquals(res.answer, 'Travel is cut by ten percent and hiring is paused.');
    assertEquals(
      res.sources.map((s) => s.item_id),
      ['i-budget'],
    );
  });
});

const workshopDeps = (ai: AIClient, saved: DraftContentT[]): WorkshopDeps => ({
  ai,
  store: usage,
  load: async () => ({
    item: { id: ITEM, title: 'Garden shed', body: 'For bikes', data: {} },
    captureText: 'build a shed https://example.com/shed',
    pageText: workshopFixture.page_text,
    facts: [
      { id: 'f1', text: 'Lives in Dublin', last_used_at: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    current: null,
  }),
  saveDraft: async (itemId, content, source) => {
    saved.push(content);
    return { id: 'd1', item_id: itemId, version: 1, content, source };
  },
  markFactsUsed: async () => {},
});

Deno.test('workshop flesh-out: the real request is accepted and the draft is cleaned', async () => {
  await viaMock(async (ai) => {
    const saved: DraftContentT[] = [];
    const res = await runFleshOut(ITEM, USER, workshopDeps(ai, saved));
    assert(res.ok, JSON.stringify(res));
    assertEquals(
      saved[0]?.summary,
      'A small timber shed at the end of the garden for bikes and tools.',
    );
    assertEquals(saved[0]?.sections.length, 1);
    assertEquals(saved[0]?.next_steps, [
      'Measure the back wall',
      "Price timber at the builders' merchant",
    ]);
  });
});

Deno.test(
  'workshop turn: the real request is accepted; three questions and a new draft',
  async () => {
    await viaMock(async (ai) => {
      const saved: DraftContentT[] = [];
      const sessions: Turn[][] = [];
      const res = await runTurn(ITEM, 'Mostly bikes', USER, {
        ...workshopDeps(ai, saved),
        loadTurns: async () => [],
        saveTurns: async (_id, turns) => {
          sessions.push(turns);
          return { id: ITEM, turns };
        },
      });
      assert(res.ok, JSON.stringify(res));
      assertEquals(saved[0]?.summary, 'A 2 x 3 m timber shed for bikes and tools.');
      assertEquals(
        sessions[0]?.map((t) => [t.role, t.text]),
        [
          ['me', 'Mostly bikes'],
          ['airhead', 'How big should it be?\nTimber or metal?\nBudget?'],
        ],
      );
    });
  },
);

Deno.test('morning brief: the real large-tier request is accepted and validated', async () => {
  await viaMock(async (ai) => {
    const b = await buildBrief(
      USER,
      digestFixture as unknown as Digest,
      {},
      new Date('2026-07-15T06:30:00Z'),
      { ai, store: usage, profile: 'Works in an office in Dublin.' },
    );
    assertEquals([b.status, b.reason], ['ok', null]);
    assertEquals(
      b.content.top3.map((t) => t.title),
      ['Call plumber', 'Send invoice', 'Book flights'],
    );
    assertEquals(b.content.also_today, ['a0000000-0000-4000-8000-000000000004']);
  });
});

Deno.test('weekly review: the real request is accepted and proposals are checked', async () => {
  await viaMock(async (ai) => {
    const c = (id: string, item_type: string | null, kind: 'item' | 'capture' = 'item') => ({
      kind,
      id,
      item_type,
      title: `Title ${id}`,
      reason: 'near_duplicate',
      mode: 'ask' as const,
      age_days: 100,
      duplicate_of: null,
    });
    const r = await buildReview(
      USER,
      { week_start: '2026-07-13', tasks: { due: 5, done: 3, added: 4 }, captures: 9 },
      [{ week_start: '2026-07-06', digest: 'A quiet week.' }],
      [
        c('i-note-a', 'note'),
        c('i-note-b', 'note'),
        c('i-idea', 'idea'),
        c('c-old', null, 'capture'),
      ],
      [
        { id: 'f1', text: 'Cycles to work', unused_days: 3 },
        { id: 'f2', text: 'Bikes to the office', unused_days: 40 },
        { id: 'f3', text: 'Training is on Mondays', unused_days: 200 },
      ],
      { ai, store: usage },
    );
    assertEquals(r.status, 'ok');
    assertEquals(
      r.content.tidy.map((t) => [t.id, t.proposal]),
      [
        ['i-note-a', 'condense'],
        ['i-note-b', 'condense'],
        ['i-idea', 'keep'],
        ['c-old', 'delete'],
      ],
    );
    assertEquals(r.content.facts.length, 2);
    assertEquals(r.digest, 'A busy week: house jobs slipped but the tax form got done.');
  });
});

Deno.test(
  'import: a screenshot request (image block) is accepted; bad events are dropped',
  async () => {
    await viaMock(async (ai) => {
      const res = await runImport(
        {
          kind: 'image',
          data: 'iVBORw0KGgo=',
          media_type: 'image/png',
          instruction: importFixture.instruction,
          today: importFixture.today,
          time_zone: 'Europe/Dublin',
        },
        USER,
        { ai, store: usage, fetch: { fetch, resolve: async () => [] } },
      );
      assert(res.ok && res.kind === 'events', JSON.stringify(res));
      assertEquals(res.message, 'Found 4 events.');
    });
  },
);

Deno.test('summarise: typed and handwritten notes are accepted and cleaned', async () => {
  await viaMock(async (ai) => {
    const typed = await runSummarise(
      { kind: 'typed', title: 'Team sync', html: summariseFixture.typed_html },
      USER,
      { ai, store: usage },
    );
    assert(typed.ok, JSON.stringify(typed));
    assertEquals(typed.result.transcription, null);
    assertEquals(typed.result.decisions, ['Launch moves to Friday']);
    const ink = await runSummarise(
      { kind: 'ink', title: 'Budget', images: ['iVBORw0KGgo='] },
      USER,
      { ai, store: usage },
    );
    assert(ink.ok, JSON.stringify(ink));
    assertEquals(ink.result.actions[0]?.owner, 'Aoife');
    assert(ink.result.transcription?.includes('cut travel 10%'));
  });
});

Deno.test(
  'suggest-leave: the real request is accepted; picks stay within the candidates',
  async () => {
    await viaMock(async (ai) => {
      const res = await runSuggestLeave(
        {
          today: '2026-04-20',
          candidates: [
            { leave: ['2026-05-05'], start: '2026-05-02', end: '2026-05-05', days_off: 4 },
            { leave: ['2026-06-02'], start: '2026-05-30', end: '2026-06-02', days_off: 4 },
            { leave: ['2026-05-01'], start: '2026-05-01', end: '2026-05-04', days_off: 4 },
          ],
          context: { occasions: [], days_since_break: 120, busy_weeks: [] },
        },
        USER,
        { ai, store: usage },
      );
      assert(res.ok, JSON.stringify(res));
      assertEquals(res.picks, [
        { index: 1, why: 'Lines up with the birthday weekend.' },
        { index: 0, why: 'Before the busy week in May.' },
      ]);
    });
  },
);

Deno.test(
  'check-contradictions: the real request is accepted; only real pairs are kept',
  async () => {
    await viaMock(async (ai) => {
      const facts = contradictionsFixture.facts;
      const r = await callAI(
        { client: ai, store: usage },
        {
          userId: USER,
          task: 'check_contradictions',
          tier: 'small',
          system: CONTRADICTIONS_SYSTEM,
          messages: [{ role: 'user', content: buildContradictionsMessage(facts) }],
          schema: ContradictionsResult,
          maxTokens: 4000,
          effort: 'low',
          background: false,
        },
      );
      assert(r.ok, JSON.stringify(r));
      const conflicts = validConflicts(
        r.data,
        facts.map((f) => f.id),
      );
      assertEquals(
        conflicts.map((c) => c.fact_ids),
        [[facts[0]!.id, facts[1]!.id]],
      );
    });
  },
);

Deno.test(
  'scout: the web search request is accepted; one search per query; safe ideas only',
  async () => {
    await viaMock(async (ai) => {
      const queries = ['jazz events in Dublin', 'markets in Dublin'];
      const res = await scoutWeb(
        USER,
        queries,
        { city: 'Dublin', timezone: 'Europe/Dublin' },
        { ai, store: usage },
      );
      assert(res.ok);
      assertEquals([res.searched, res.searches], [queries, 2]);
      assertEquals(
        res.ideas.map((i) => i.url),
        ['https://example.com/christmas-market', 'https://example.com/trail-run'],
      );
      assert(res.cost_eur > 0.017);
    });
  },
);

Deno.test('every saved answer fits the schema its function sends', () => {
  const schemas: Record<string, z.ZodType> = {
    sort_batch: SortResult,
    ask: AskResult,
    morning_brief: BriefResult,
    check_contradictions: ContradictionsResult,
    workshop_flesh_out: DraftContent,
    workshop_turn: TurnResult,
    import_extract: ImportResult,
    suggest_leave: LeaveResult,
    weekly_review: ReviewResult,
    summarise_note: SummaryResult,
  };
  // The check itself catches drift: a missing field or a wrong type.
  const askJson = (zodOutputFormat(AskResult) as unknown as { schema: unknown }).schema;
  assert(schemaMismatch(askJson, { answer: 'x' }));
  assert(schemaMismatch(askJson, { answer: 'x', citations: ['1'] }));
  assertEquals(TASKS.map((t: { task: string }) => t.task).sort(), Object.keys(schemas).sort());
  for (const t of TASKS as { task: string; answer: (q: unknown) => unknown }[]) {
    const schema = schemas[t.task]!;
    const json = (zodOutputFormat(schema as never) as unknown as { schema: unknown }).schema;
    for (const images of [false, true]) {
      const answer = t.answer({ user: '', images });
      assertEquals(schemaMismatch(json, answer), null, t.task);
      assert(schema.safeParse(answer).success, t.task);
    }
  }
});

Deno.test('a prompt the stand-in does not know is refused, not answered', async () => {
  await viaMock(async (ai) => {
    const r = await callAI(
      { client: ai, store: usage },
      { ...request(AskResult, 'You do something new.', 'x'), task: 'new_task' },
    );
    assertEquals([r.ok, rows.at(-1)?.error_code], [false, 'api_error']);
  });
});
