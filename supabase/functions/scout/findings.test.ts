import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { findFindings, type ItemRow } from './findings.ts';

// Wednesday 15 July 2026, 10:00 in Dublin.
const NOW = new Date('2026-07-15T09:00:00Z');
const TZ = 'Europe/Dublin';
const item = (over: Partial<ItemRow>): ItemRow => ({
  id: crypto.randomUUID(),
  type: 'task',
  title: 'x',
  status: 'open',
  data: {},
  start_at: null,
  due_at: null,
  rrule: null,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-10T10:00:00Z',
  ...over,
});

Deno.test('meetings without a follow-up, from 1 to 14 days ago', () => {
  const recent = item({
    type: 'meeting',
    title: 'Budget review',
    data: { meeting_date: '2026-07-13' },
  });
  const done = item({
    type: 'meeting',
    title: 'Done one',
    data: { meeting_date: '2026-07-13', summary: { summary: 'x' } },
  });
  const followed = item({
    type: 'meeting',
    title: 'Tasks made',
    data: { meeting_date: '2026-07-12' },
  });
  const today = item({ type: 'meeting', title: 'Today', data: { meeting_date: '2026-07-15' } });
  const f = findFindings({
    now: NOW,
    timeZone: TZ,
    items: [recent, done, followed, today],
    followedUp: new Set([followed.id]),
    linkedStarts: [],
  });
  assertEquals(
    f.map((x) => [x.kind, x.title]),
    [['follow_up', 'Follow up on Budget review']],
  );
});

Deno.test('birthdays and events marked for prep in the next 10 days', () => {
  const f = findFindings({
    now: NOW,
    timeZone: TZ,
    items: [
      item({ type: 'event', title: "Mam's birthday", start_at: '2026-07-20T11:00:00Z' }),
      item({
        type: 'event',
        title: 'Interview',
        start_at: '2026-07-17T09:00:00Z',
        data: { prep: true },
      }),
      item({ type: 'event', title: 'Dentist', start_at: '2026-07-16T09:00:00Z' }),
      item({ type: 'event', title: 'Far birthday', start_at: '2026-08-20T11:00:00Z' }),
    ],
    followedUp: new Set(),
    linkedStarts: [],
  });
  assertEquals(
    f.map((x) => [x.kind, x.title, (x.proposed as { due_date?: string })?.due_date]),
    [
      ['prep', "Mam's birthday is on Monday 20 July", '2026-07-19'],
      ['prep', 'Prep for Interview', '2026-07-16'],
    ],
  );
});

Deno.test('overdue routines and stalled ideas', () => {
  const f = findFindings({
    now: NOW,
    timeZone: TZ,
    items: [
      item({ title: 'Water plants', rrule: 'FREQ=WEEKLY', due_at: '2026-07-12T09:00:00Z' }),
      item({ title: 'One-off overdue', due_at: '2026-07-12T09:00:00Z' }),
      item({ type: 'idea', title: 'Garden office', updated_at: '2026-06-01T10:00:00Z' }),
      item({ type: 'idea', title: 'Fresh idea', updated_at: '2026-07-14T10:00:00Z' }),
    ],
    followedUp: new Set(),
    linkedStarts: [],
  });
  assertEquals(
    f.map((x) => [x.kind, x.title]),
    [
      ['routine', 'Water plants is overdue'],
      ['stalled_idea', 'Pick up “Garden office”?'],
    ],
  );
});

Deno.test('weekend days free on both calendars (only with a linked calendar), at most two', () => {
  const f = findFindings({
    now: NOW,
    timeZone: TZ,
    items: [item({ type: 'event', title: 'Match', start_at: '2026-07-18T13:00:00Z' })],
    followedUp: new Set(),
    linkedStarts: ['2026-07-19T10:00:00Z'],
  });
  assertEquals(
    f.map((x) => x.title),
    ['Saturday 25 July is free for you both', 'Sunday 26 July is free for you both'],
  );
  assertEquals(
    findFindings({ now: NOW, timeZone: TZ, items: [], followedUp: new Set(), linkedStarts: [] }),
    [],
  );
});
