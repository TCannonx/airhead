// Follow-ups and planning steps (Task 12.1), and answers (Task 12.2): every
// note that implies more work is moved forward, never left silent.
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { SORT_BATCH_SYSTEM, buildSortMessage } from '../_shared/prompts/sort-batch.v7.ts';
import type { FollowUpT, SortAnswer, SortedItemT } from '../_shared/schemas/sort.ts';
import { cleanFollowUps, planningDue, planSort } from './plan.ts';

// Monday 9 November 2026, 10:00 in Dublin (GMT).
const NOW = new Date('2026-11-09T10:00:00Z');
const TZ = 'Europe/Dublin';
const ctx = { now: NOW, timeZone: TZ, topics: [], lists: [], ideas: [] };
const C1 = 'c0000000-0000-4000-8000-000000001201';
const C2 = 'c0000000-0000-4000-8000-000000001202';
const ITEM = 'e0000000-0000-4000-8000-000000001201';

const item = (o: Partial<SortedItemT> = {}): SortedItemT => ({
  type: 'event',
  title: 'Christmas sandwiches',
  body: null,
  start_at: '2026-11-13T00:00:00+00:00',
  end_at: null,
  all_day: true,
  due_at: null,
  rrule: 'FREQ=WEEKLY;BYDAY=FR',
  list_name: null,
  topics: [],
  confidence: 0.9,
  suggest_workshop: false,
  related_idea_title: null,
  quote: 'Planning Christmas sandwiches every week on a Friday',
  steps: [],
  ...o,
});
const planning = (o: Partial<SortedItemT> = {}) =>
  item({
    type: 'task',
    title: 'Plan Christmas sandwiches',
    start_at: null,
    all_day: false,
    rrule: null,
    quote: 'Still need to plan',
    steps: ['Decide who they are for', 'Count how many people', 'Choose fillings'],
    ...o,
  });
const q = (question: string, options: string[] = [], about_item = 0): FollowUpT => ({
  question,
  options,
  about_item,
});
const result = (capture_id: string, o: Partial<SortAnswer['results'][number]> = {}) => ({
  capture_id,
  items: [],
  actions: [],
  leftover: null,
  follow_ups: [],
  proposed_facts: [],
  link_summary: null,
  ...o,
});

Deno.test('the prompt asks for planning steps and specific questions, none on clear notes', () => {
  assert(SORT_BATCH_SYSTEM.includes('Move it forward'));
  assert(SORT_BATCH_SYSTEM.includes('follow_ups'));
  assert(SORT_BATCH_SYSTEM.includes('gets NO questions'));
  assert(SORT_BATCH_SYSTEM.includes('answer_to'));
});

Deno.test(
  'Christmas: event, planning task due before the first Friday with steps, questions',
  () => {
    const plan = planSort(
      [C1],
      {
        results: [
          result(C1, {
            items: [item(), planning()],
            follow_ups: [
              q('Who are the sandwiches for?', ['Family', 'Work', 'Friends']),
              q('How many people?'),
              q('Making them or ordering?', ['Making', 'Ordering']),
            ],
          }),
        ],
      },
      ctx,
    );
    const [ev, task] = plan.items;
    assertEquals([ev!.type, task!.type], ['event', 'task']);
    // 09:00 on Thursday 12 November, the day before the first Friday.
    assertEquals(task!.due_at, '2026-11-12T09:00:00.000Z');
    assertEquals(task!.data.planning, true);
    assertEquals(task!.data.steps, [
      'Decide who they are for',
      'Count how many people',
      'Choose fillings',
    ]);
    assertEquals(
      task!.body,
      '- [ ] Decide who they are for\n- [ ] Count how many people\n- [ ] Choose fillings',
    );
    assertEquals(task!.data.quote, 'Still need to plan');
    assertEquals(
      plan.follow_ups.map((f) => [f.question, f.options, f.item_id, f.capture_id, f.round]),
      [
        ['Who are the sandwiches for?', ['Family', 'Work', 'Friends'], ev!.id, C1, 1],
        ['How many people?', [], ev!.id, C1, 1],
        ['Making them or ordering?', ['Making', 'Ordering'], ev!.id, C1, 1],
      ],
    );
    assertEquals(plan.workshop, []);
    assertEquals(plan.captures, [{ id: C1, status: 'sorted' }]);
  },
);

Deno.test('questions: at most 3, at most 4 quick answers, never generic, no repeats', () => {
  const out = cleanFollowUps([
    q('Anything else?'),
    q('Any more details?'),
    q('  Who is it  for? ', ['A', 'B', 'C', 'D', 'E', 'A', ' ']),
    q('who is it for?'),
    q('How many?'),
    q('Where?'),
    q('When?'),
  ]);
  assertEquals(
    out.map((f) => [f.question, f.options]),
    [
      ['Who is it for?', ['A', 'B', 'C', 'D']],
      ['How many?', []],
      ['Where?', []],
    ],
  );
});

Deno.test('a question about no item points at the first item that is not the planning task', () => {
  const plan = planSort(
    [C1],
    {
      results: [
        result(C1, { items: [planning(), item()], follow_ups: [q('How many people?', [], -1)] }),
      ],
    },
    ctx,
  );
  assertEquals(plan.follow_ups[0]!.item_id, plan.items[1]!.id);
});

Deno.test('planning due: before the first occurrence, else the model date, else in 3 days', () => {
  // Event on Friday: 09:00 Thursday.
  assertEquals(planningDue(null, '2026-11-13T00:00:00Z', NOW, TZ), '2026-11-12T09:00:00.000Z');
  // A model date later than that is pulled in; an earlier one is kept.
  assertEquals(
    planningDue('2026-11-20T09:00:00Z', '2026-11-13T00:00:00Z', NOW, TZ),
    '2026-11-12T09:00:00.000Z',
  );
  assertEquals(
    planningDue('2026-11-10T09:00:00.000Z', '2026-11-13T00:00:00Z', NOW, TZ),
    '2026-11-10T09:00:00.000Z',
  );
  // An event tomorrow at 18:00: 09:00 tomorrow (the day before is already past).
  assertEquals(planningDue(null, '2026-11-10T18:00:00Z', NOW, TZ), '2026-11-10T09:00:00.000Z');
  // No event: the stated deadline, or 09:00 in 3 days.
  assertEquals(planningDue('2026-11-30T09:00:00Z', null, NOW, TZ), '2026-11-30T09:00:00Z');
  assertEquals(planningDue(null, null, NOW, TZ), '2026-11-12T09:00:00.000Z');
  assertEquals(planningDue('2026-11-01T09:00:00Z', null, NOW, TZ), '2026-11-12T09:00:00.000Z');
});

Deno.test('a clear note gets no questions and no planning task', () => {
  const plan = planSort(
    [C1],
    {
      results: [
        result(C1, {
          items: [
            item({
              title: 'Niamh’s birthday',
              rrule: 'FREQ=YEARLY',
              quote: 'Niamh’s Birthday 11/11',
            }),
          ],
        }),
      ],
    },
    ctx,
  );
  assertEquals(plan.follow_ups, []);
  assertEquals(plan.items[0]!.data.planning, undefined);
  assertEquals(plan.items[0]!.data.quote, 'Niamh’s Birthday 11/11');
});

Deno.test(
  'steps only make a planning task of a task; older answers without the fields still plan',
  () => {
    const plan = planSort(
      [C1],
      {
        results: [
          {
            capture_id: C1,
            items: [
              { ...item({ steps: ['ignored'] }) },
              (({ quote: _q, steps: _s, ...rest }) => rest)(planning()),
            ],
            actions: [],
            proposed_facts: [],
            link_summary: null,
          },
        ],
      },
      ctx,
    );
    assertEquals(plan.items[0]!.data.planning, undefined);
    assertEquals(plan.items[1]!.data.planning, undefined);
    assertEquals(plan.follow_ups, []);
  },
);

Deno.test('questions from a note result belong to the note', () => {
  const NOTE = 'a0000000-0000-4000-8000-000000001201';
  const plan = planSort(
    [],
    {
      results: [
        result(`note:${NOTE}`, {
          items: [planning({ title: 'Plan the team night out' })],
          follow_ups: [q('Which venue?', ['Pub', 'Restaurant'])],
        }),
      ],
    },
    { ...ctx, notes: [{ id: NOTE, seen_len: 10, seen_hash: 'h' }] },
  );
  assertEquals(plan.follow_ups.length, 1);
  assertEquals([plan.follow_ups[0]!.capture_id, plan.follow_ups[0]!.note_id], [null, NOTE]);
  assertEquals(plan.items[0]!.due_at, '2026-11-12T09:00:00.000Z');
});

Deno.test(
  'an answer is added to the item it was about, with Undo, and is never sent to the Workshop',
  () => {
    const answers = new Map([
      [
        C2,
        {
          follow_up_id: 'd0000000-0000-4000-8000-000000001201',
          question: 'Who are the sandwiches for?',
          round: 1,
          item: {
            id: ITEM,
            title: 'Christmas sandwiches',
            body: null,
            updated_at: '2026-11-09T09:00:00Z',
          },
        },
      ],
    ]);
    const plan = planSort(
      [C2],
      {
        results: [
          result(C2, {
            items: [
              item({
                type: 'task',
                title: 'Order sandwiches for the office',
                start_at: null,
                rrule: null,
              }),
            ],
            follow_ups: [q('How many people?'), q('Which fillings?')],
          }),
        ],
      },
      { ...ctx, texts: new Map([[C2, 'The office team']]), answers },
    );
    assertEquals(plan.item_updates.length, 1);
    const up = plan.item_updates[0]!;
    assertEquals(
      [up.item_id, up.capture_id, up.before, up.after, up.quote],
      [
        ITEM,
        C2,
        { body: null, updated_at: '2026-11-09T09:00:00Z' },
        { body: 'Who are the sandwiches for? The office team' },
        'The office team',
      ],
    );
    assertEquals(up.summary, 'Added your answer to “Christmas sandwiches”');
    // One more round at most, one question, about the same item.
    assertEquals(
      plan.follow_ups.map((f) => [f.question, f.item_id, f.round]),
      [['How many people?', ITEM, 2]],
    );
    assertEquals(plan.workshop, []);
    assertEquals(
      plan.items.map((i) => i.title),
      ['Order sandwiches for the office'],
    );
  },
);

Deno.test(
  'a second-round answer asks nothing more; an answer the model skipped is still kept',
  () => {
    const answers = new Map([
      [
        C2,
        {
          follow_up_id: 'd0000000-0000-4000-8000-000000001202',
          question: 'How many people?',
          round: 2,
          item: {
            id: ITEM,
            title: 'Christmas sandwiches',
            body: 'Who are the sandwiches for? The office team',
            updated_at: '2026-11-09T09:00:00Z',
          },
        },
      ],
    ]);
    const opts = { ...ctx, texts: new Map([[C2, '12']]), answers };
    const asked = planSort(
      [C2],
      { results: [result(C2, { follow_ups: [q('Which day?')] })] },
      opts,
    );
    assertEquals(asked.follow_ups, []);
    assertEquals(asked.item_updates[0]!.after, {
      body: 'Who are the sandwiches for? The office team\nHow many people? 12',
    });
    assertEquals(asked.captures, [{ id: C2, status: 'sorted' }]);
    const skipped = planSort([C2], { results: [] }, opts);
    assertEquals(skipped.workshop, []);
    assertEquals(skipped.item_updates.length, 1);
  },
);

Deno.test('an answer capture carries the question and the item in its block', () => {
  const msg = buildSortMessage(
    {
      now: NOW.toISOString(),
      timeZone: TZ,
      topics: [],
      lists: [],
      ideas: [],
      corrections: [],
      candidates: [],
    },
    [
      {
        id: C2,
        text: 'The office team',
        url: null,
        answer: {
          question: 'Who are the "sandwiches" for?',
          about: 'Christmas sandwiches | event | ',
          final: true,
        },
      },
    ],
  );
  assert(
    msg.includes(
      `<capture id="${C2}" answer_to="Who are the 'sandwiches' for?" about="Christmas sandwiches | event | " final="true">`,
    ),
    msg,
  );
});
