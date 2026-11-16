import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { defaultNudges, type PlanItem, readPlanSettings } from './defaults.ts';

const TZ = 'Europe/Dublin';
const S = readPlanSettings({});
const EARLY = new Date('2026-01-01T00:00:00Z');

function event(over: Partial<PlanItem> = {}): PlanItem {
  return { type: 'event', title: 'Training', all_day: false, ...over };
}

function summary(item: PlanItem, start: string, now = EARLY, settings = S) {
  return defaultNudges(item, new Date(start), settings, TZ, now).map((n) => `${n.kind}@${n.at}`);
}

Deno.test(
  "owner's case: training 08:00 gives prepare 20:30 the evening before and leave 07:20",
  () => {
    // 18 November 2026 is GMT (UTC+0) in Dublin.
    assertEquals(summary(event(), '2026-11-18T08:00:00Z'), [
      'prepare@2026-11-17T20:30:00.000Z',
      'leave@2026-11-18T07:20:00.000Z',
    ]);
  },
);

Deno.test('nothing at 07:30 and no prepare inside 45 minutes of the start', () => {
  const out = defaultNudges(event(), new Date('2026-11-18T08:00:00Z'), S, TZ, EARLY);
  for (const n of out) {
    if (n.kind === 'prepare')
      assertEquals(Date.parse(n.at) <= Date.parse('2026-11-18T07:15:00Z'), true);
    assertEquals(n.at === '2026-11-18T07:30:00.000Z', false);
    assertEquals(n.reason.length > 0, true);
  }
});

Deno.test('noon boundary: 11:59 is prepared the evening before, 12:00 three hours before', () => {
  assertEquals(summary(event(), '2026-11-18T11:59:00Z')[0], 'prepare@2026-11-17T20:30:00.000Z');
  assertEquals(summary(event(), '2026-11-18T12:00:00Z')[0], 'prepare@2026-11-18T09:00:00.000Z');
});

Deno.test('afternoon prepare never before 08:00 on the day', () => {
  // 13:00 start → 10:00 (fine); a 12:30 start → 09:30.
  assertEquals(summary(event(), '2026-11-18T12:30:00Z')[0], 'prepare@2026-11-18T09:30:00.000Z');
});

Deno.test('the item travel time beats the default', () => {
  const out = summary(event({ travel_minutes: 50 }), '2026-11-18T14:00:00Z');
  assertEquals(out.includes('leave@2026-11-18T13:00:00.000Z'), true);
});

Deno.test('Europe/Dublin clock change: summer time event uses local wall times', () => {
  // 29 March 2026 clocks go forward at 01:00 UTC. A 08:00 IST event on 30 March is 07:00Z.
  assertEquals(summary(event(), '2026-03-30T07:00:00Z'), [
    'prepare@2026-03-29T19:30:00.000Z', // 20:30 IST
    'leave@2026-03-30T06:20:00.000Z',
  ]);
  // The evening before the change: event 08:00 IST on 29 March, prepare 20:30 GMT on the 28th.
  assertEquals(summary(event(), '2026-03-29T07:00:00Z')[0], 'prepare@2026-03-28T20:30:00.000Z');
});

Deno.test('all-day events: prepare the evening before only with prep text or a prep rule', () => {
  assertEquals(summary(event({ all_day: true }), '2026-11-18T00:00:00Z'), []);
  assertEquals(summary(event({ all_day: true, prep: ['Pack boots'] }), '2026-11-18T00:00:00Z'), [
    'prepare@2026-11-17T20:30:00.000Z',
  ]);
  assertEquals(
    summary(event({ all_day: true, has_prep_rule: true }), '2026-11-18T00:00:00Z').length,
    1,
  );
});

Deno.test('tasks: do at the due time; due date only gives nothing', () => {
  const task: PlanItem = { type: 'task', title: 'Send form', all_day: false };
  assertEquals(summary(task, '2026-11-18T15:00:00Z'), ['do@2026-11-18T15:00:00.000Z']);
  assertEquals(summary({ ...task, all_day: true }, '2026-11-18T00:00:00Z'), []);
});

Deno.test('never returns a time in the past', () => {
  const now = new Date('2026-11-17T21:00:00Z'); // after the 20:30 prepare
  assertEquals(summary(event(), '2026-11-18T08:00:00Z', now), ['leave@2026-11-18T07:20:00.000Z']);
  assertEquals(summary(event(), '2026-11-18T08:00:00Z', new Date('2026-11-18T09:00:00Z')), []);
});

Deno.test(
  'an afternoon event with a short lead drops the prepare rather than sending it late',
  () => {
    // prepare evening time set to 23:50; a 00:20 event would get prepare 30 min before → dropped.
    const s = readPlanSettings({ plan: { prepare_evening_time: '23:50' } });
    const out = summary(event(), '2026-11-18T00:20:00Z', EARLY, s);
    assertEquals(
      out.some((x) => x.startsWith('prepare')),
      false,
    );
  },
);

Deno.test('settings are read with defaults and bad values ignored', () => {
  assertEquals(
    readPlanSettings({ plan: { prepare_evening_time: '9pm', default_travel_minutes: -3 } }),
    S,
  );
  assertEquals(
    readPlanSettings({ plan: { default_travel_minutes: 15 } }).default_travel_minutes,
    15,
  );
  assertEquals(S, {
    prepare_evening_time: '20:30',
    default_travel_minutes: 30,
    evening_time: '18:00',
    enabled: true,
    daily_cap_eur: 0.15,
  });
});
