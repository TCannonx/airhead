import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1.0.19';
import type { SortActionT } from '../_shared/schemas/sort.ts';
import {
  type ActionContext,
  type BookingRow,
  dateRange,
  type ItemRow,
  MAX_ACTIONS,
  type NewItemRef,
  planActions,
} from './actions.ts';
import type { Candidate } from './candidates.ts';

// Sunday 8 November 2026, noon in Dublin; leave year 1 Dec 2025 – 30 Nov 2026.
const NOW = new Date('2026-11-08T12:00:00Z');
const blank: SortActionT = {
  kind: 'set_leave_remaining',
  quote: 'q',
  confidence: 0.9,
  days: null,
  as_of: null,
  leave_type: null,
  start_date: null,
  end_date: null,
  start_half: null,
  end_half: null,
  leave_status: null,
  setting: null,
  value: null,
  target_item_index: null,
  target_id: null,
  other_matches: [],
  remind_at: null,
  offset_minutes: null,
  start_at: null,
  end_at: null,
  all_day: null,
  due_at: null,
  match: null,
  reminder: null,
  minutes_before: null,
};
const act = (o: Partial<SortActionT>): SortActionT => ({ ...blank, ...o });
const ctx = (o: Partial<ActionContext> = {}): ActionContext => ({
  userId: 'u1',
  now: NOW,
  today: '2026-11-08',
  timeZone: 'Europe/Dublin',
  workRaw: { entitlement: 21 },
  bookings: [],
  candidates: [],
  items: new Map(),
  ...o,
});
const one = (a: Partial<SortActionT>, c: Partial<ActionContext> = {}, items: NewItemRef[] = []) =>
  planActions('cap', [act(a)], items, ctx(c))[0];
const booking = (start: string, end: string, o: Partial<BookingRow> = {}): BookingRow => ({
  id: `b-${start}`,
  start_date: start,
  end_date: end,
  start_half: false,
  end_half: false,
  leave_type: 'annual',
  status: 'taken',
  deleted_at: null,
  ...o,
});

// Leave balance -----------------------------------------------------------------------

Deno.test('9.5 days left: stores the days used before Airhead so the counter shows 9.5', () => {
  // 2 working days already booked (Mon 2 – Tue 3 March): 21 − 2 − 9.5 = 9.5 used before.
  const a = one(
    { days: 9.5, as_of: '2026-11-08', leave_type: 'annual' },
    { bookings: [booking('2026-03-02', '2026-03-03')] },
  );
  assertEquals(a.status, 'applied');
  assertEquals(a.target_table, 'settings');
  assertEquals(a.target_id, 'u1');
  assertEquals(a.before, { opening_used: null });
  assertEquals(a.after, { opening_used: { '2025-12-01': 9.5 } });
  assertEquals(a.summary, 'Leave left set to 9.5 days');
});

Deno.test('leave planned after today is not counted as already used', () => {
  const a = one(
    { days: 9.5 },
    { bookings: [booking('2026-11-23', '2026-11-24', { status: 'planned' })] },
  );
  assertEquals(a.after, { opening_used: { '2025-12-01': 11.5 } });
});

Deno.test('days used: stores the part Airhead does not know about', () => {
  const a = one(
    { kind: 'set_leave_used', days: 12 },
    { bookings: [booking('2026-03-02', '2026-03-03')] },
  );
  assertEquals([a.status, a.summary], ['applied', 'Leave used set to 12 days']);
  assertEquals(a.after, { opening_used: { '2025-12-01': 10 } });
});

Deno.test('no entitlement set yet: a proposal asking for it, with nothing to apply', () => {
  const a = one({ days: 9.5 }, { workRaw: {} });
  assertEquals([a.status, a.after], ['proposed', null]);
  assertEquals(a.reason, 'Set your yearly entitlement first (Settings → Work)');
});

Deno.test('leave balance: odd numbers, sick leave, other years, too many, too few', () => {
  assertEquals(one({ days: 9.3 }).reason, 'That number of days doesn’t look right');
  assertEquals(one({ days: -1 }).status, 'proposed');
  assertEquals(
    one({ days: 3, leave_type: 'sick' }).reason,
    'Sick leave isn’t counted against your allowance',
  );
  assertEquals(one({ days: 3, as_of: '2027-01-05' }).reason, 'That date isn’t in this leave year');
  assertEquals(one({ days: 30 }).reason, 'More than your yearly total (21 days)');
  const busy = Array.from({ length: 5 }, (_, i) =>
    booking(`2026-0${i + 2}-02`, `2026-0${i + 2}-06`, { id: `b${i}` }),
  );
  assertEquals(
    one({ days: 9.5 }, { bookings: busy }).reason,
    'Airhead already has more leave recorded than that',
  );
});

Deno.test('leave balance already right: skipped; unsure: proposed but still one tap', () => {
  const raw = { entitlement: 21, opening_used: { '2025-12-01': 11.5 } };
  assertEquals(one({ days: 9.5 }, { workRaw: raw }).status, 'skipped');
  const unsure = one({ days: 9.5, confidence: 0.5 });
  assertEquals(unsure.status, 'proposed');
  assertEquals(unsure.reason, 'Not sure enough to do this by itself');
  assert(unsure.after);
});

// Leave bookings ---------------------------------------------------------------------------

Deno.test('off 22–24 Dec: books 3 days of planned annual leave', () => {
  const a = one({ kind: 'book_leave', start_date: '2026-12-22', end_date: '2026-12-24' });
  assertEquals(a.status, 'applied');
  assertEquals(a.target_table, 'leave_bookings');
  assertMatch(a.target_id ?? '', /^[0-9a-f-]{36}$/);
  assertEquals(a.after, {
    start_date: '2026-12-22',
    end_date: '2026-12-24',
    start_half: false,
    end_half: false,
    leave_type: 'annual',
    status: 'planned',
    days: 3,
  });
  assertEquals(a.summary, 'Annual leave booked: 22–24 Dec (3 days)');
});

Deno.test('past leave is recorded as taken; sick leave keeps its type', () => {
  const a = one({
    kind: 'book_leave',
    start_date: '2026-11-06',
    end_date: '2026-11-06',
    leave_type: 'sick',
    leave_status: 'planned',
  });
  assertEquals(a.after?.status, 'taken');
  assertEquals(a.after?.leave_type, 'sick');
});

Deno.test('bookings: bad dates, too long, too far, unknown type, clash, no working days', () => {
  const r = (o: Partial<SortActionT>, c: Partial<ActionContext> = {}) =>
    one({ kind: 'book_leave', ...o }, c).reason;
  assertEquals(
    r({ start_date: '2026-12-24', end_date: '2026-12-22' }),
    'Those dates don’t look right',
  );
  assertEquals(
    r({ start_date: '2026-12-01', end_date: '2027-03-01' }),
    'That’s longer than 60 days; book it by hand',
  );
  assertEquals(
    r({ start_date: '2028-01-03', end_date: '2028-01-04' }),
    'Only this leave year and the next can be booked',
  );
  assertEquals(
    r({ start_date: '2026-12-22', end_date: '2026-12-22', leave_type: 'sabbatical' }),
    'There’s no “sabbatical” leave type yet (Settings → Work)',
  );
  assertEquals(
    r(
      { start_date: '2026-12-22', end_date: '2026-12-24' },
      { bookings: [booking('2026-12-23', '2026-12-23')] },
    ),
    'Overlaps leave on 23 Dec',
  );
  assertEquals(
    r({ start_date: '2026-12-26', end_date: '2026-12-27' }),
    'No working days in those dates',
  );
});

// Work settings --------------------------------------------------------------------------------

Deno.test('I get 23 days a year: entitlement set, undo restores the absent value', () => {
  const a = one(
    { kind: 'update_work_setting', setting: 'entitlement', value: '23' },
    { workRaw: {} },
  );
  assertEquals(a.status, 'applied');
  assertEquals(a.before, { entitlement: null });
  assertEquals(a.after, { entitlement: 23 });
  assertEquals(a.summary, 'Entitlement set to 23 days');
});

Deno.test('settings: leave year, working days, usual week (merged), carry-over', () => {
  const s = (setting: SortActionT['setting'], value: string) =>
    one({ kind: 'update_work_setting', setting, value });
  assertEquals(s('leave_year_start', '"01-01"').summary, 'Leave year now starts 1 Jan');
  assertEquals(s('leave_year_start', '01-01').after, { leave_year_start: '01-01' });
  assertEquals(s('working_days', '[4,1,2,3]').after, { working_days: [1, 2, 3, 4] });
  assertEquals(s('working_days', '[4,1,2,3]').summary, 'Working days set to Mon, Tue, Wed, Thu');
  const week = s('location_pattern', '{"1":"wfh"}');
  assertEquals(week.summary, 'Usual week: Mon WFH');
  assertEquals((week.after?.location_pattern as Record<string, string>)['1'], 'wfh');
  assertEquals((week.after?.location_pattern as Record<string, string>)['2'], 'office');
  assertEquals(s('carry_over_max', '3').summary, 'Carry-over limit set to 3 days');
});

Deno.test('settings: nonsense values are proposals; the same value is skipped', () => {
  const s = (setting: SortActionT['setting'], value: string) =>
    one({ kind: 'update_work_setting', setting, value });
  for (const [k, v] of [
    ['entitlement', '500'],
    ['entitlement', '"lots"'],
    ['leave_year_start', '"13-01"'],
    ['working_days', '[9]'],
    ['location_pattern', '{"1":"beach"}'],
  ] as const)
    assertEquals(s(k, v).reason, 'That setting value doesn’t look right', `${k}=${v}`);
  assertEquals(s('entitlement', '21').status, 'skipped');
});

// Reminders ------------------------------------------------------------------------------------------

const newEvent = (o: Partial<NewItemRef> = {}): NewItemRef => ({
  id: 'n1',
  type: 'event',
  start_at: '2026-11-14T19:00:00Z',
  all_day: false,
  due_at: null,
  data: {},
  ...o,
});

Deno.test('remind me the day before: sets the new event’s reminder in the plan', () => {
  const item = newEvent();
  const a = one({ kind: 'set_reminder', target_item_index: 0, offset_minutes: 1440 }, {}, [item]);
  assertEquals(a.status, 'applied');
  assertEquals(a.summary, 'Reminder set: 1 day before');
  assertEquals(a.target_id, 'n1');
  assertEquals(item.data, { reminder_minutes: '1440' });
  assertEquals(a.before, { data: {} });
});

Deno.test(
  'reminders: all-day, too early, unknown target, and an unsure one leaves the item',
  () => {
    assertEquals(
      one({ kind: 'set_reminder', target_item_index: 0, offset_minutes: 60 }, {}, [
        newEvent({ all_day: true }),
      ]).reason,
      'All-day events don’t have a reminder time',
    );
    assertEquals(
      one({ kind: 'set_reminder', target_item_index: 0, offset_minutes: 5000 }, {}, [newEvent()])
        .reason,
      'Reminders can be up to a day before',
    );
    assertEquals(
      one({ kind: 'set_reminder', target_item_index: 3, offset_minutes: 60 }).reason,
      'Couldn’t tell which item the reminder is for',
    );
    const item = newEvent();
    one({ kind: 'set_reminder', target_item_index: 0, offset_minutes: 60, confidence: 0.3 }, {}, [
      item,
    ]);
    assertEquals(item.data, {});
  },
);

Deno.test('a task reminder becomes its due time', () => {
  const task = newEvent({ type: 'task', start_at: null });
  const a = one(
    { kind: 'set_reminder', target_item_index: 0, remind_at: '2026-11-13T09:00:00+00:00' },
    {},
    [task],
  );
  assertEquals(a.status, 'applied');
  assertEquals(task.due_at, '2026-11-13T09:00:00.000Z');
  assertEquals(a.summary, 'Reminder set for Fri 13 Nov, 09:00');
});

// Moving existing items ----------------------------------------------------------------------------

const DENTIST = 'e1';
const cand = (id: string, title: string, o: Partial<Candidate> = {}): Candidate => ({
  id,
  type: 'event',
  title,
  when: '2026-11-10T15:00:00Z',
  repeats: false,
  ...o,
});
const row = (id: string, o: Partial<ItemRow> = {}): ItemRow => ({
  id,
  type: 'event',
  start_at: '2026-11-10T15:00:00.000Z',
  end_at: '2026-11-10T16:00:00.000Z',
  all_day: false,
  due_at: null,
  data: {},
  updated_at: '2026-11-01T09:00:00.000Z',
  ...o,
});
const moving = (o: Partial<ActionContext> = {}) =>
  ctx({
    candidates: [cand(DENTIST, 'Dentist')],
    items: new Map([[DENTIST, row(DENTIST)]]),
    ...o,
  });

Deno.test(
  'dentist moved to Thursday 4pm: moves it, keeps its length, remembers the old time',
  () => {
    const [a] = planActions(
      'cap',
      [act({ kind: 'reschedule_item', target_id: DENTIST, start_at: '2026-11-12T16:00:00+00:00' })],
      [],
      moving(),
    );
    assertEquals(a.status, 'applied');
    assertEquals(a.summary, 'Moved “Dentist” to Thu 12 Nov, 16:00');
    assertEquals(a.after, {
      start_at: '2026-11-12T16:00:00.000Z',
      end_at: '2026-11-12T17:00:00.000Z',
      all_day: false,
    });
    assertEquals(a.before, {
      start_at: '2026-11-10T15:00:00.000Z',
      end_at: '2026-11-10T16:00:00.000Z',
      all_day: false,
      updated_at: '2026-11-01T09:00:00.000Z',
    });
  },
);

Deno.test('moving: two possible matches asks which one, offering both', () => {
  const [a] = planActions(
    'cap',
    [
      act({
        kind: 'reschedule_item',
        target_id: 'm1',
        other_matches: ['m2', 'not-a-candidate'],
        start_at: '2026-11-13T10:00:00+00:00',
      }),
    ],
    [],
    ctx({
      candidates: [cand('m1', 'Team meeting'), cand('m2', 'Team meeting')],
      items: new Map([
        ['m1', row('m1')],
        ['m2', row('m2')],
      ]),
    }),
  );
  assertEquals([a.status, a.reason, a.after], ['proposed', 'Which one?', null]);
  assertEquals(a.payload.choices, ['m1', 'm2']);
});

Deno.test('moving: repeats, unknown item, past time; a task gets a new due time', () => {
  const rep = planActions(
    'cap',
    [act({ kind: 'reschedule_item', target_id: 'y', start_at: '2026-11-11T18:00:00Z' })],
    [],
    ctx({ candidates: [cand('y', 'Yoga', { repeats: true })], items: new Map([['y', row('y')]]) }),
  )[0];
  assertEquals(rep.reason, 'This repeats; change one or all?');
  const unknown = one({
    kind: 'reschedule_item',
    target_id: 'nope',
    start_at: '2026-11-11T18:00:00Z',
  });
  assertEquals(unknown.reason, 'Couldn’t tell which item to move');
  assertEquals(unknown.payload.choices, []);
  const past = planActions(
    'cap',
    [act({ kind: 'reschedule_item', target_id: DENTIST, start_at: '2026-11-01T10:00:00Z' })],
    [],
    moving(),
  )[0];
  assertEquals(past.reason, 'The new time doesn’t look right');
  const task = planActions(
    'cap',
    [act({ kind: 'reschedule_item', target_id: 't', due_at: '2026-11-20T17:00:00Z' })],
    [],
    ctx({
      candidates: [cand('t', 'Car tax', { type: 'task' })],
      items: new Map([
        [
          't',
          row('t', {
            type: 'task',
            start_at: null,
            end_at: null,
            due_at: '2026-11-15T09:00:00.000Z',
          }),
        ],
      ]),
    }),
  )[0];
  assertEquals(task.status, 'applied');
  assertEquals(task.after, { due_at: '2026-11-20T17:00:00.000Z' });
  assertEquals(task.before?.due_at, '2026-11-15T09:00:00.000Z');
});

// General ----------------------------------------------------------------------------------------------

Deno.test('at most five actions per capture; quotes are trimmed', () => {
  const many = Array.from({ length: 8 }, () => act({ days: 9.5, quote: '  9.5 days left  ' }));
  const out = planActions('cap', many, [], ctx());
  assertEquals(out.length, MAX_ACTIONS);
  assertEquals(out[0].quote, '9.5 days left');
});

Deno.test('date ranges read naturally', () => {
  assertEquals(dateRange('2026-12-22', '2026-12-22'), '22 Dec');
  assertEquals(dateRange('2026-12-22', '2026-12-24'), '22–24 Dec');
  assertEquals(dateRange('2026-12-30', '2027-01-02'), '30 Dec – 2 Jan');
});

// Standing prep rules ---------------------------------------------------------------

Deno.test('"once booked, make sure I have cash": a prep rule for matching events', () => {
  const a = one(
    {
      kind: 'add_prep_rule',
      match: ['Barber', 'haircut', 'x'],
      reminder: 'Bring €20 cash',
      minutes_before: 720,
    },
    { workRaw: {} },
  );
  assertEquals(a.status, 'applied');
  assertEquals(a.summary, 'Prep reminder: “Bring €20 cash” before “barber” or “haircut” events');
  assertEquals(a.before, { prep_rules: null });
  const [rule] = a.after?.prep_rules as { match: string[]; minutes_before: number; id: string }[];
  assertEquals([rule!.match, rule!.minutes_before], [['barber', 'haircut'], 720]);
  assertMatch(rule!.id, /^[0-9a-f]{8}$/);
});

Deno.test('prep rules: missing words or reminder ask; the same rule twice is skipped', () => {
  assertEquals(
    one({ kind: 'add_prep_rule', match: [], reminder: 'Bring cash' }).reason,
    'Which events, and what to remind?',
  );
  assertEquals(
    one({ kind: 'add_prep_rule', match: ['barber'], reminder: 'x', minutes_before: 99999 }).reason,
    'Prep reminders can be up to a week before',
  );
  const existing = {
    entitlement: 21,
    prep_rules: [
      { id: 'r1', match: ['haircut', 'barber'], reminder: 'Bring €20 cash', minutes_before: 720 },
    ],
  };
  assertEquals(
    one(
      { kind: 'add_prep_rule', match: ['barber', 'haircut'], reminder: 'bring €20 cash' },
      { workRaw: existing },
    ).status,
    'skipped',
  );
});
