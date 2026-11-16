import type { Lookup } from '../_shared/ai.ts';
import {
  getPage,
  type HistoryStore,
  previousOccurrences,
  searchHistory,
} from '../_shared/history/lookups.ts';

/** The three look-ups (Task 14.6) as tools for the planner (Task 14.8). */
export function planLookups(store: HistoryStore, userId: string): Record<string, Lookup> {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    search_history: {
      description:
        "Search the person's own history (items by meaning and keyword). Optional from/to dates (YYYY-MM-DD) and types (task, event, reading, idea, meeting, note).",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          types: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
      },
      run: (i) =>
        searchHistory(store, userId, str(i.query), {
          from: str(i.from) || undefined,
          to: str(i.to) || undefined,
          types: Array.isArray(i.types)
            ? i.types.filter((t): t is string => typeof t === 'string')
            : undefined,
        }),
    },
    get_page: {
      description:
        'The running page about a person, place, project, repeating event (series) or topic: summary, dated facts and recent items.',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['person', 'place', 'project', 'series', 'topic'] },
          name: { type: 'string' },
        },
        required: ['kind', 'name'],
      },
      run: async (i) =>
        (await getPage(store, userId, str(i.kind), str(i.name))) ?? { found: false },
    },
    previous_occurrences: {
      description:
        'Earlier occurrences of the same repeating or similar event, with what was prepared and what the person did with the reminders.',
      input_schema: {
        type: 'object',
        properties: { item_id: { type: 'string' }, n: { type: 'integer' } },
        required: ['item_id'],
      },
      run: (i) =>
        previousOccurrences(store, userId, str(i.item_id), typeof i.n === 'number' ? i.n : 3),
    },
  };
}
