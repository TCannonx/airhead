import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { type CandidateRow, pickCandidates } from './candidates.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const row = (id: string, o: Partial<CandidateRow> = {}): CandidateRow => ({
  id,
  type: 'event',
  title: id,
  start_at: null,
  due_at: null,
  rrule: null,
  series_id: null,
  status: 'open',
  ...o,
});

Deno.test('candidates: the window, overdue tasks, nearest first, repeats flagged', () => {
  const got = pickCandidates(
    [
      row('far', { start_at: '2027-03-01T10:00:00Z' }),
      row('old', { start_at: '2026-10-01T10:00:00Z' }),
      row('soon', { start_at: '2026-11-10T15:00:00Z' }),
      row('recent', { start_at: '2026-11-05T09:00:00Z' }),
      row('overdue', { type: 'task', due_at: '2026-09-01T09:00:00Z' }),
      row('rep', { start_at: '2026-11-11T18:00:00Z', rrule: 'FREQ=WEEKLY' }),
      row('done', { start_at: '2026-11-10T09:00:00Z', status: 'done' }),
      row('note', { type: 'note', start_at: '2026-11-09T09:00:00Z' }),
      row('undated', { type: 'task' }),
    ],
    NOW,
  );
  assertEquals(
    got.map((c) => c.id),
    ['soon', 'recent', 'rep', 'overdue'],
  );
  assertEquals(got[2].repeats, true);
});

Deno.test('candidates: at most 60', () => {
  const many = Array.from({ length: 80 }, (_, i) =>
    row(`e${i}`, { start_at: new Date(NOW.getTime() + i * 3_600_000).toISOString() }),
  );
  assertEquals(pickCandidates(many, NOW).length, 60);
});
