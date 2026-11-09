// Workshop routing (Task 11.2): what sorting cannot place is kept, never dropped.
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { SORT_BATCH_SYSTEM } from '../_shared/prompts/sort-batch.v7.ts';
import type { SortAnswer, SortedItemT } from '../_shared/schemas/sort.ts';
import { planSort, workshopTitle } from './plan.ts';

const NOW = new Date('2026-11-09T10:00:00Z');
const ctx = { now: NOW, topics: [], lists: [], ideas: [] };
const C1 = 'c0000000-0000-4000-8000-000000000361';
const C2 = 'c0000000-0000-4000-8000-000000000362';
const PLACEHOLDER =
  'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder';
const VAGUE = 'hmm the thing with the stuff';
const texts = new Map([
  [C1, VAGUE],
  [C2, PLACEHOLDER],
]);

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
  quote: '',
  steps: [],
  ...o,
});
const result = (
  id: string,
  o: Partial<SortAnswer['results'][number]> = {},
): SortAnswer['results'][number] => ({
  capture_id: id,
  items: [],
  actions: [],
  proposed_facts: [],
  link_summary: null,
  ...o,
});

Deno.test('the prompt asks for suggest_workshop on placeholders and for leftover words', () => {
  assert(SORT_BATCH_SYSTEM.includes('still need to plan'));
  assert(SORT_BATCH_SYSTEM.includes('leftover:'));
});

Deno.test('a capture the batch could not map at all becomes a Workshop note, sorted', () => {
  const p = planSort([C1], { results: [result(C1)] }, { ...ctx, texts });
  assertEquals(
    p.items.map((i) => [i.type, i.title, i.body, i.capture_id, i.status, i.data]),
    [
      [
        'note',
        'Hmm the thing with the stuff',
        VAGUE,
        C1,
        'open',
        { workshop: true, workshop_from: 'unmapped' },
      ],
    ],
  );
  assertEquals(p.captures, [{ id: C1, status: 'sorted' }]);
  assertEquals(p.workshop, [{ capture_id: C1, item_id: p.items[0]!.id, reason: 'unmapped' }]);
});

Deno.test('a capture the model skipped is kept in the Workshop too', () => {
  const p = planSort([C1], { results: [] }, { ...ctx, texts });
  assertEquals(p.captures, [{ id: C1, status: 'sorted' }]);
  assertEquals(p.workshop[0]?.reason, 'unmapped');
  assertEquals(p.items[0]?.body, VAGUE);
});

Deno.test('without the capture text (older callers) an unplaced capture still needs review', () => {
  const p = planSort([C1], { results: [result(C1)] }, ctx);
  assertEquals(p.captures, [{ id: C1, status: 'needs_review' }]);
  assertEquals(p.workshop, []);
});

Deno.test('partial use: the event is made and the leftover becomes a Workshop note', () => {
  const p = planSort(
    [C2],
    { results: [result(C2, { items: [item()], leftover: ' Still need to plan ' })] },
    { ...ctx, texts },
  );
  assertEquals(
    p.items.map((i) => [i.type, i.title, i.data.workshop ?? false]),
    [
      ['event', 'Christmas sandwiches', false],
      ['note', 'Still need to plan', true],
    ],
  );
  // The note keeps the whole capture, word for word.
  assertEquals(p.items[1]?.body, PLACEHOLDER);
  assertEquals(p.captures, [{ id: C2, status: 'sorted' }]);
  assertEquals(p.workshop, [{ capture_id: C2, item_id: p.items[1]!.id, reason: 'leftover' }]);
});

Deno.test('suggest_workshop marks the item; no leftover means no extra note', () => {
  const p = planSort(
    [C2],
    {
      results: [
        result(C2, {
          items: [item(), item({ type: 'idea', title: 'Sandwich plan', suggest_workshop: true })],
          leftover: null,
        }),
      ],
    },
    { ...ctx, texts },
  );
  assertEquals(
    p.items.map((i) => [i.title, i.data.workshop ?? false]),
    [
      ['Christmas sandwiches', false],
      ['Sandwich plan', true],
    ],
  );
  assertEquals(p.workshop, []);
});

Deno.test('a leftover that repeats an item title is not doubled', () => {
  const p = planSort(
    [C2],
    { results: [result(C2, { items: [item()], leftover: 'christmas sandwiches' })] },
    { ...ctx, texts },
  );
  assertEquals(p.items.length, 1);
  assertEquals(p.workshop, []);
});

Deno.test('a note with leftover words is marked for the Workshop when stamped', () => {
  const seen = { id: 'n1', seen_len: 10, seen_hash: 'h' };
  const p = planSort(
    [],
    { results: [result('note:n1', { leftover: 'still need to plan the menu' })] },
    { ...ctx, notes: [seen, { id: 'n2', seen_len: 1, seen_hash: 'x' }] },
  );
  assertEquals(p.notes, [
    { ...seen, workshop: true },
    { id: 'n2', seen_len: 1, seen_hash: 'x' },
  ]);
  assertEquals(p.items, []);
});

Deno.test('a saved web page never routes to the Workshop', () => {
  const p = planSort([], { results: [result(C1, { leftover: 'ignore' })] }, { ...ctx, texts }, [
    C1,
  ]);
  assertEquals(p.items, []);
  assertEquals(p.workshop, []);
});

Deno.test('Workshop titles: first line, capitalised, no full stop, at most 80 characters', () => {
  assertEquals(workshopTitle('still need to plan.\nmore'), 'Still need to plan');
  assertEquals(workshopTitle('x'.repeat(100)).length, 80);
  assertEquals(workshopTitle('   '), 'Untitled');
});
