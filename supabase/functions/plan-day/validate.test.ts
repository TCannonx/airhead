import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { PlanResultT } from '../_shared/schemas/plan.ts';
import type { DigestItem, PlanDigest } from './digest.ts';
import { validatePlan } from './validate.ts';

// Evening of Tuesday 17 November 2026, Dublin (GMT); quiet hours 22:00–07:30.
const NOW = new Date('2026-11-17T18:00:00Z');

const training: DigestItem = {
  item_id: 'train',
  kind: 'event',
  occurrence_date: '2026-11-18',
  at: '2026-11-18T08:00:00.000Z',
  time: '08:00',
  end: '09:30',
  all_day: false,
  title: 'Training',
};
const form: DigestItem = {
  item_id: 'form',
  kind: 'task',
  occurrence_date: '2026-11-18',
  at: '2026-11-18T15:00:00.000Z',
  time: '15:00',
  end: null,
  all_day: false,
  title: 'Send form',
};
const linked: DigestItem = { ...training, item_id: 'ext', kind: 'linked', title: 'Offsite' };

const digest: PlanDigest = {
  date: '2026-11-17',
  time_zone: 'Europe/Dublin',
  now: '2026-11-17 18:00',
  quiet_hours: { start: '22:00', end: '07:30' },
  brief_time: '07:30',
  prepare_evening_time: '20:30',
  default_travel_minutes: 30,
  days: [],
  items: [training, form, linked],
  prep_rules: [],
  topics: [],
};

type Nudge = PlanResultT['items'][number]['nudges'][number];
const n = (kind: Nudge['kind'], at: string, delivery: Nudge['delivery'] = 'push'): Nudge => ({
  kind,
  at,
  title: `${kind} title`,
  body: 'b',
  reason: 'r',
  delivery,
});

function result(items: PlanResultT['items']): PlanResultT {
  return { items, tonight: [], clashes: [], digest_draft: '' };
}
function item(
  id: string,
  nudges: Nudge[],
  over: Partial<PlanResultT['items'][number]> = {},
): PlanResultT['items'][number] {
  return {
    item_id: id,
    occurrence_date: '2026-11-18',
    surface_at: '',
    effort_minutes: 0,
    needs: [],
    prep: ['Bag'],
    nudges,
    reason: 'why',
    confidence: 0.9,
    reading_slot: '',
    ...over,
  };
}

Deno.test("the owner's bag example passes: prepare the evening before, leave at 07:20", () => {
  const { payload, dropped } = validatePlan(
    result([item('train', [n('prepare', '2026-11-17 20:30'), n('leave', '2026-11-18 07:20')])]),
    digest,
    {},
    NOW,
  );
  assertEquals(dropped, []);
  assertEquals(
    payload.nudges.map((x) => [x.key, x.send_at]),
    [
      ['plan:prepare:train:2026-11-18', '2026-11-17T20:30:00.000Z'],
      ['plan:leave:train:2026-11-18', '2026-11-18T07:20:00.000Z'],
    ],
  );
  assertEquals(payload.items[0]?.prep, ['Bag']);
  assertEquals(payload.occurrences, [{ item_id: 'train', date: '2026-11-18' }]);
});

Deno.test('a prepare at 07:30 for an 08:00 start is dropped (inside 45 minutes)', () => {
  const { payload, dropped } = validatePlan(
    result([item('train', [n('prepare', '2026-11-18 07:30')])]),
    digest,
    {},
    NOW,
  );
  assertEquals(payload.nudges, []);
  assertEquals(dropped[0]?.why, 'prepare inside 45 minutes of the start');
});

Deno.test('unknown ids, linked events, past and unreadable times are dropped', () => {
  const { payload, dropped } = validatePlan(
    result([
      item('ghost', [n('do', '2026-11-18 10:00')]),
      item('ext', [n('leave', '2026-11-18 10:00')]),
      item('form', [n('do', '2026-11-17 17:00'), n('follow_up', 'tomorrow')]),
    ]),
    digest,
    {},
    NOW,
  );
  assertEquals(payload.nudges, []);
  assertEquals(
    dropped.map((d) => d.why),
    ['not in the digest', 'not in the digest', 'in the past', 'unreadable time'],
  );
});

Deno.test('quiet hours: a push prepare is dropped, leave and do go through, digest is fine', () => {
  const { payload, dropped } = validatePlan(
    result([
      item('train', [n('prepare', '2026-11-17 23:00'), n('leave', '2026-11-18 07:15')]),
      item('form', [n('do', '2026-11-18 06:00'), n('reading', '2026-11-17 23:30', 'push')]),
    ]),
    digest,
    {},
    NOW,
  );
  assertEquals(payload.nudges.map((x) => `${x.kind}:${x.delivery}`).sort(), [
    'do:push',
    'leave:push',
    'reading:digest',
  ]);
  assertEquals(
    dropped.map((d) => d.why),
    ['push in quiet hours'],
  );
});

Deno.test('at most 3 nudges per occurrence and one of each kind', () => {
  const { payload, dropped } = validatePlan(
    result([
      item('form', [
        n('do', '2026-11-18 15:00'),
        n('do', '2026-11-18 15:05'),
        n('prepare', '2026-11-18 09:00'),
        n('follow_up', '2026-11-18 16:00'),
        n('reading', '2026-11-18 12:00'),
      ]),
    ]),
    digest,
    {},
    NOW,
  );
  assertEquals(payload.nudges.length, 3);
  assertEquals(
    dropped.map((d) => d.why),
    ['a second nudge of the same kind', 'more than 3 nudges for one occurrence'],
  );
});

Deno.test('the daily cap keeps the earliest pushes of each day', () => {
  const { payload, dropped } = validatePlan(
    result([
      item('train', [n('prepare', '2026-11-17 20:30'), n('leave', '2026-11-18 07:20')]),
      item('form', [n('do', '2026-11-18 15:00'), n('prepare', '2026-11-18 09:00')]),
    ]),
    digest,
    { notifications: { daily_cap: 2 } },
    NOW,
  );
  assertEquals(
    payload.nudges.map((x) => x.send_at),
    ['2026-11-17T20:30:00.000Z', '2026-11-18T07:20:00.000Z', '2026-11-18T09:00:00.000Z'],
  );
  assertEquals(
    dropped.map((d) => [d.kind, d.why]),
    [['do', 'over the daily nudge cap']],
  );
});

Deno.test('plan fields are tidied: surface time, effort, confidence', () => {
  const { payload } = validatePlan(
    result([
      item('form', [], { surface_at: '2026-11-18 09:00', effort_minutes: 45.6, confidence: 3 }),
    ]),
    digest,
    {},
    NOW,
  );
  assertEquals(payload.items[0], {
    item_id: 'form',
    surface_at: '2026-11-18T09:00:00.000Z',
    effort_minutes: 46,
    needs: [],
    prep: ['Bag'],
    reason: 'why',
    confidence: 1,
    reading_slot: null,
  });
});

Deno.test(
  'reading (Task 16.7): a saved link takes only a reading suggestion, in the digest, with its slot',
  () => {
    const reading: DigestItem = {
      item_id: 'link',
      kind: 'reading',
      occurrence_date: '2026-11-18',
      at: null,
      time: null,
      end: null,
      all_day: true,
      title: 'Marathon plan',
    };
    const { payload, dropped } = validatePlan(
      result([
        item('link', [n('reading', '2026-11-18 08:15', 'push'), n('do', '2026-11-18 09:00')], {
          reading_slot: 'commute',
        }),
      ]),
      { ...digest, items: [...digest.items, reading] },
      {},
      NOW,
    );
    assertEquals(
      payload.nudges.map((x) => `${x.kind}:${x.delivery}`),
      ['reading:digest'],
    );
    assertEquals(payload.items[0]?.reading_slot, 'commute');
    assertEquals(
      dropped.map((d) => d.why),
      ['only a reading suggestion for a saved link'],
    );
  },
);
