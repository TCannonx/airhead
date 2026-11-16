import { assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  getPage,
  type HistoryItem,
  type HistoryStore,
  pageNameKey,
  previousOccurrences,
  searchHistory,
} from './lookups.ts';

const U = 'u1';
function item(id: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id,
    type: 'event',
    title: id,
    body: null,
    start_at: null,
    due_at: null,
    created_at: '2026-01-01T00:00:00Z',
    series_id: null,
    rrule: null,
    ...over,
  };
}

const ITEMS = [
  item('dentist-aug', {
    title: 'Dentist',
    start_at: '2026-08-12T13:00:00Z',
    body: 'Bring the insurance card',
  }),
  item('dentist-feb', { title: 'Dentist', start_at: '2026-02-03T13:00:00Z' }),
  item('form', { type: 'task', title: 'Dental form', due_at: '2026-08-20T17:00:00Z' }),
  item('m1', { title: 'Hurling match', start_at: '2026-10-04T14:00:00Z', series_id: 's1' }),
  item('m2', { title: 'Hurling match', start_at: '2026-10-11T14:00:00Z', series_id: 's1' }),
  item('m3', { title: 'Hurling match', start_at: '2026-10-18T14:00:00Z', series_id: 's1' }),
  item('training', { title: 'Training', start_at: '2026-11-18T08:00:00Z' }),
  item('training-old', { title: 'Training session', start_at: '2026-11-11T08:00:00Z' }),
];

function store(over: Partial<HistoryStore> = {}): HistoryStore & { searched: string[] } {
  const searched: string[] = [];
  const byId = new Map(ITEMS.map((i) => [i.id, i]));
  return {
    searched,
    embed: async () => [0.1],
    search: async (_u, q) => {
      searched.push(q);
      return ['dentist-aug', 'form', 'dentist-feb', 'ghost'];
    },
    items: async (_u, ids) =>
      ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as HistoryItem] : [])),
    page: async (_u, kind, key) =>
      key === 'person:niamh'
        ? {
            id: 'p1',
            kind,
            name: 'Niamh',
            summary: 'A friend from work.',
            facts: [{ date: '2026-10-01', text: 'Vegetarian' }],
          }
        : null,
    pageItems: async () => [ITEMS[0] as HistoryItem],
    seriesBefore: async (_u, s, before, n) =>
      ITEMS.filter((i) => i.series_id === s && (i.start_at ?? '') < before)
        .sort((a, b) => (b.start_at ?? '').localeCompare(a.start_at ?? ''))
        .slice(0, n),
    eventsLike: async (_u, title, before, n, exclude) =>
      ITEMS.filter(
        (i) =>
          i.id !== exclude &&
          i.type === 'event' &&
          (i.start_at ?? '') < before &&
          i.title.toLowerCase().includes(title.toLowerCase().split(' ')[0] ?? ''),
      ).slice(0, n),
    planned: async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          id === 'training-old'
            ? {
                prep: ['Boots'],
                nudges: [{ kind: 'prepare', at: '2026-11-10T20:30:00Z', outcome: 'snoozed' }],
              }
            : { prep: [], nudges: [] },
        ]),
      ),
    ...over,
  };
}

Deno.test('search_history: compact rows, best first, unknown ids skipped', async () => {
  const rows = await searchHistory(store(), U, ' dentist ');
  assertEquals(
    rows.map((r) => [r.id, r.date]),
    [
      ['dentist-aug', '2026-08-12'],
      ['form', '2026-08-20'],
      ['dentist-feb', '2026-02-03'],
    ],
  );
  assertEquals(rows[0]?.line, 'Bring the insurance card');
});

Deno.test('search_history: date range, types and limit', async () => {
  const s = store();
  assertEquals(
    (await searchHistory(s, U, 'dentist', { from: '2026-06-01', types: ['event'] })).map(
      (r) => r.id,
    ),
    ['dentist-aug'],
  );
  assertEquals((await searchHistory(s, U, 'dentist', { limit: 1 })).length, 1);
  assertEquals(await searchHistory(s, U, '   '), []);
  assertEquals(s.searched, ['dentist', 'dentist']);
});

Deno.test('search_history works without the embedding model', async () => {
  const rows = await searchHistory(
    store({ embed: () => Promise.reject(new Error('no model')) }),
    U,
    'dentist',
  );
  assertEquals(rows.length, 3);
});

Deno.test('get_page: by normalised name, with summary, facts and recent items', async () => {
  const p = await getPage(store(), U, 'person', '  NIAMH ');
  assertEquals(p?.summary, 'A friend from work.');
  assertEquals(
    p?.items.map((i) => i.id),
    ['dentist-aug'],
  );
  assertEquals(await getPage(store(), U, 'person', 'Nobody'), null);
  assertEquals(pageNameKey('  Mary  Kate '), 'mary kate');
});

Deno.test('previous_occurrences: the same series first, most recent first', async () => {
  const rows = await previousOccurrences(store(), U, 'm3', 3);
  assertEquals(
    rows.map((r) => r.id),
    ['m2', 'm1'],
  );
});

Deno.test(
  'previous_occurrences: else earlier events by title, with prep and what was done with the nudges',
  async () => {
    const rows = await previousOccurrences(store(), U, 'training', 3);
    assertEquals(
      rows.map((r) => r.id),
      ['training-old'],
    );
    assertEquals(rows[0]?.prep, ['Boots']);
    assertEquals(rows[0]?.nudges[0]?.outcome, 'snoozed');
    assertEquals(await previousOccurrences(store(), U, 'ghost'), []);
  },
);
