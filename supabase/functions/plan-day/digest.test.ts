import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { buildPlanDigest, DIGEST_CAP, type RawPlanDigest } from './digest.ts';

// Evening of Tuesday 17 November 2026 (Dublin, GMT).
const NOW = new Date('2026-11-17T18:00:00Z');

function raw(over: Partial<RawPlanDigest> = {}): RawPlanDigest {
  return {
    date: '2026-11-17',
    time_zone: 'Europe/Dublin',
    items: [],
    linked: [],
    nudges: [],
    leave: [],
    work_days: [],
    ...over,
  };
}

type RawItem = RawPlanDigest['items'][number];
function item(over: Partial<RawItem>): RawItem {
  return {
    id: 'i',
    type: 'event',
    title: 'Thing',
    start_at: null,
    end_at: null,
    due_at: null,
    all_day: false,
    rrule: null,
    exdates: [],
    location: null,
    travel_minutes: null,
    plan: null,
    ...over,
  };
}

const NORMAL = raw({
  items: [
    item({
      id: 'train',
      title: 'Training',
      start_at: '2026-11-18T08:00:00Z',
      end_at: '2026-11-18T09:30:00Z',
      location: 'Gym',
    }),
    item({ id: 'quiz', title: 'Quiz', start_at: '2026-11-20T19:00:00Z' }),
    item({
      id: 'flight',
      title: 'Flight to Paris',
      start_at: '2026-11-21T06:00:00Z',
      travel_minutes: 60,
    }),
    item({ id: 'form', type: 'task', title: 'Send form', due_at: '2026-11-18T15:00:00Z' }),
    item({
      id: 'weekly',
      title: 'Team call',
      start_at: '2026-11-04T10:00:00Z',
      end_at: '2026-11-04T10:30:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    }),
    item({
      id: 'report',
      type: 'task',
      title: 'Write report',
      due_at: '2026-11-23T17:00:00Z',
      plan: { surface_at: null, effort_minutes: 120, prep: [], reason: 'Big', source: 'ai' },
    }),
  ],
  linked: [
    {
      id: 'ext',
      title: 'Work offsite',
      start_at: '2026-11-18T13:00:00Z',
      end_at: null,
      all_day: false,
    },
  ],
  nudges: [
    {
      item_id: 'train',
      kind: 'prepare',
      send_at: '2026-11-17T20:30:00Z',
      source: 'default',
      dedupe_key: 'plan:prepare:train:2026-11-18',
    },
  ],
  work_days: [{ date: '2026-11-18', location: 'office' }],
});

Deno.test('a normal day: tomorrow in full, later only what needs lead time, soonest first', () => {
  const { digest, left_out } = buildPlanDigest(NORMAL, {}, NOW);
  assertEquals(
    digest.items.map((i) => `${i.occurrence_date} ${i.time ?? 'all day'} ${i.title}`),
    [
      '2026-11-18 08:00 Training',
      '2026-11-18 10:00 Team call',
      '2026-11-18 13:00 Work offsite',
      '2026-11-18 15:00 Send form',
      '2026-11-21 06:00 Flight to Paris',
      '2026-11-23 17:00 Write report',
    ],
  );
  assertEquals(left_out, 0);
  const train = digest.items[0];
  assertEquals(train?.end, '09:30');
  assertEquals(train?.location, 'Gym');
  assertEquals(train?.nudges, [{ kind: 'prepare', at: '2026-11-17 20:30', source: 'default' }]);
  assertEquals(digest.items[2]?.kind, 'linked');
  assertEquals(digest.days[0], { date: '2026-11-18', weekday: 'Wednesday', location: 'office' });
  assertEquals(digest.days.length, 7);
  assertEquals(
    [digest.now, digest.prepare_evening_time, digest.quiet_hours.end],
    ['2026-11-17 18:00', '20:30', '07:30'],
  );
});

Deno.test('a prep rule brings a later event in, and the rules are passed on', () => {
  const settings = {
    work: { prep_rules: [{ id: 'r', match: ['quiz'], reminder: 'Bring a pen' }] },
  };
  const { digest } = buildPlanDigest(NORMAL, settings, NOW);
  const quiz = digest.items.find((i) => i.title === 'Quiz');
  assertEquals(quiz?.prep_rule, true);
  assertEquals(digest.prep_rules, [{ match: ['quiz'], reminder: 'Bring a pen' }]);
});

Deno.test('an empty day gives no items but still the days and settings', () => {
  const { digest, left_out } = buildPlanDigest(raw(), {}, NOW);
  assertEquals([digest.items, left_out], [[], 0]);
  assertEquals(digest.days.length, 7);
});

Deno.test('over the cap: the soonest 60 are kept and the rest counted', () => {
  const many = raw({
    items: Array.from({ length: 75 }, (_, n) =>
      item({
        id: `e${n}`,
        title: `Event ${String(n).padStart(2, '0')}`,
        start_at: new Date(Date.parse('2026-11-18T07:00:00Z') + n * 10 * 60_000).toISOString(),
      }),
    ),
  });
  const { digest, left_out } = buildPlanDigest(many, {}, NOW);
  assertEquals(digest.items.length, DIGEST_CAP);
  assertEquals(left_out, 15);
  assertEquals(digest.items.at(-1)?.title, 'Event 59');
});

Deno.test('a deleted occurrence of a repeating event is left out', () => {
  const r = raw({
    items: [
      item({
        id: 'w',
        title: 'Team call',
        start_at: '2026-11-04T10:00:00Z',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        exdates: ['2026-11-18T10:00:00.000Z'],
      }),
    ],
  });
  assertEquals(buildPlanDigest(r, {}, NOW).digest.items, []);
});
