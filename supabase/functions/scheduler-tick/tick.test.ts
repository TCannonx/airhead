import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { inQuietHours, localMidnightIso, readNotif } from './notif.ts';
import {
  occurrencesBetween,
  runTick,
  type LeaveRow,
  type NewNudge,
  type Nudge,
  type RecurringRow,
  type TaskRow,
  type TickStore,
  type WorkDayRow,
} from './tick.ts';

const U = 'user-1';

interface Row extends Nudge {
  status: string;
  dedupe_key: string;
  sent_at: string | null;
}

function memory(seed: {
  settings?: Record<string, unknown>;
  nudges?: Partial<Row>[];
  tasks?: TaskRow[];
  recurring?: RecurringRow[];
  leave?: LeaveRow[];
  workDays?: WorkDayRow[];
}) {
  let n = 0;
  const nudges: Row[] = (seed.nudges ?? []).map((x) => ({
    id: `n${++n}`,
    kind: 'task_due',
    send_at: '2026-07-14T10:00:00.000Z',
    title: 'Task',
    body: null,
    url: null,
    status: 'pending',
    dedupe_key: `seed${n}`,
    sent_at: null,
    ...x,
  }));
  const jobs = new Set<string>();
  const store: TickStore = {
    users: () =>
      Promise.resolve([{ user_id: U, settings: { time_zone: 'Europe/Dublin', ...seed.settings } }]),
    due: (_u, now) =>
      Promise.resolve(nudges.filter((x) => x.status === 'pending' && x.send_at <= now)),
    sentSince: (_u, since) =>
      Promise.resolve(
        nudges.filter(
          (x) => x.status === 'sent' && x.kind !== 'summary' && (x.sent_at ?? '') >= since,
        ).length,
      ),
    lastSummaryAt: () =>
      Promise.resolve(
        nudges
          .filter((x) => x.kind === 'summary')
          .map((x) => x.sent_at ?? '')
          .sort()
          .at(-1) ?? null,
      ),
    addNudge: (_u, x: NewNudge) => {
      if (!nudges.some((y) => y.dedupe_key === x.dedupe_key))
        nudges.push({ id: `n${++n}`, status: 'pending', sent_at: null, ...x });
      return Promise.resolve();
    },
    logSent: (_u, x) => {
      nudges.push({ id: `n${++n}`, status: 'sent', sent_at: x.send_at, ...x });
      return Promise.resolve();
    },
    setStatus: (ids, status, at) => {
      for (const x of nudges)
        if (ids.includes(x.id))
          Object.assign(x, { status, sent_at: status === 'sent' ? at : x.sent_at });
      return Promise.resolve();
    },
    claimJob: (_u, job, date) => {
      const k = `${job}|${date}`;
      if (jobs.has(k)) return Promise.resolve(false);
      jobs.add(k);
      return Promise.resolve(true);
    },
    openTasks: () => Promise.resolve(seed.tasks ?? []),
    recurringEvents: () => Promise.resolve(seed.recurring ?? []),
    leave: () => Promise.resolve(seed.leave ?? []),
    workDays: () => Promise.resolve(seed.workDays ?? []),
  };
  const sent: { title: string; body?: string; url?: string; tag?: string }[] = [];
  const send = (_u: string, p: { title: string; body?: string; url?: string; tag?: string }) => {
    sent.push(p);
    return Promise.resolve('sent' as const);
  };
  return { store, nudges, sent, send };
}

const at = (iso: string) => new Date(iso);
// Jobs are switched off unless a test is about them.
const quietJobs = {
  notifications: {
    types: { evening_review: false, checklist: false, slip: false, leave_runout: false },
  },
};

Deno.test('settings: defaults, quiet hours across midnight, local midnight', () => {
  const s = readNotif({});
  assertEquals(
    [s.quiet_start, s.quiet_end, s.daily_cap, s.evening_review_time],
    ['22:00', '07:30', 8, '21:00'],
  );
  assert(
    inQuietHours('23:15', s) &&
      inQuietHours('06:59', s) &&
      !inQuietHours('07:30', s) &&
      !inQuietHours('12:00', s),
  );
  assertEquals(readNotif({ notifications: { daily_cap: 0, quiet_start: '25:00' } }).daily_cap, 8);
  // Summer: Irish midnight is 23:00 UTC the day before.
  assertEquals(localMidnightIso('2026-07-14', 'Europe/Dublin'), '2026-07-13T23:00:00.000Z');
  assertEquals(localMidnightIso('2026-12-14', 'Europe/Dublin'), '2026-12-14T00:00:00.000Z');
});

Deno.test('sends due nudges and leaves future ones', async () => {
  const m = memory({
    settings: quietJobs,
    nudges: [
      { title: 'Due now', send_at: '2026-07-14T09:59:00.000Z' },
      { title: 'Later', send_at: '2026-07-14T11:00:00.000Z' },
    ],
  });
  const r = await runTick(at('2026-07-14T10:00:00Z'), m.store, m.send);
  assertEquals(r.sent, 1);
  assertEquals(
    m.sent.map((s) => s.title),
    ['Due now'],
  );
  assertEquals(
    m.nudges.map((x) => x.status),
    ['sent', 'pending'],
  );
});

Deno.test('quiet hours defer nudges until morning; event reminders can come through', async () => {
  const m = memory({
    settings: quietJobs,
    nudges: [
      { kind: 'task_due', title: 'Task at night', send_at: '2026-07-14T22:00:00.000Z' },
      { kind: 'event_reminder', title: 'Late film', send_at: '2026-07-14T22:00:00.000Z' },
    ],
  });
  // 23:05 Irish summer time
  const night = await runTick(at('2026-07-14T22:05:00Z'), m.store, m.send);
  assertEquals([night.sent, night.deferred], [1, 1]);
  assertEquals(
    m.sent.map((s) => s.title),
    ['Late film'],
  );
  // 07:31 the next morning
  await runTick(at('2026-07-15T06:31:00Z'), m.store, m.send);
  assertEquals(
    m.sent.map((s) => s.title),
    ['Late film', 'Task at night'],
  );

  const strict = memory({
    settings: { notifications: { ...quietJobs.notifications, quiet_allows_events: false } },
    nudges: [{ kind: 'event_reminder', title: 'Late film', send_at: '2026-07-14T22:00:00.000Z' }],
  });
  assertEquals((await runTick(at('2026-07-14T22:05:00Z'), strict.store, strict.send)).deferred, 1);
});

Deno.test('over the daily cap, extras are bundled into one summary, at most hourly', async () => {
  const m = memory({
    settings: { notifications: { ...quietJobs.notifications, daily_cap: 2 } },
    nudges: ['A', 'B', 'C', 'D'].map((t, i) => ({
      title: t,
      send_at: `2026-07-14T10:0${i}:00.000Z`,
    })),
  });
  const r = await runTick(at('2026-07-14T10:05:00Z'), m.store, m.send);
  assertEquals([r.sent, r.bundled], [2, 2]);
  assertEquals(
    m.sent.map((s) => s.title),
    ['A', 'B', '2 more reminders'],
  );
  assertEquals(m.sent[2]?.body, 'C · D');

  // Two more arrive ten minutes later: still over the cap, and a summary went out recently.
  m.nudges.push({
    id: 'x1',
    kind: 'task_due',
    send_at: '2026-07-14T10:14:00.000Z',
    title: 'E',
    body: null,
    url: null,
    status: 'pending',
    dedupe_key: 'x1',
    sent_at: null,
  });
  const r2 = await runTick(at('2026-07-14T10:15:00Z'), m.store, m.send);
  assertEquals([r2.sent, r2.deferred], [0, 1]);
  // An hour later they are bundled.
  const r3 = await runTick(at('2026-07-14T11:10:00Z'), m.store, m.send);
  assertEquals(r3.bundled, 1);
});

Deno.test('stale and switched-off nudges are cancelled, not sent late', async () => {
  const m = memory({
    settings: {
      notifications: {
        ...quietJobs.notifications,
        types: { ...quietJobs.notifications.types, task_due: false },
      },
    },
    nudges: [
      { kind: 'event_reminder', title: 'Old event', send_at: '2026-07-14T06:00:00.000Z' },
      { kind: 'task_due', title: 'Off', send_at: '2026-07-14T09:59:00.000Z' },
    ],
  });
  const r = await runTick(at('2026-07-14T10:00:00Z'), m.store, m.send);
  assertEquals([r.sent, r.cancelled], [0, 2]);
});

Deno.test('the evening review runs once, at 21:00 local time (time zones)', async () => {
  const tasks: TaskRow[] = [
    {
      id: 't1',
      title: 'Report',
      due_at: '2026-07-14T16:00:00.000Z',
      top3_date: null,
      carry_count: 0,
    },
    { id: 't2', title: 'Plan', due_at: null, top3_date: '2026-07-14', carry_count: 0 },
    {
      id: 't3',
      title: 'Next week',
      due_at: '2026-07-21T16:00:00.000Z',
      top3_date: null,
      carry_count: 0,
    },
  ];
  const only = { notifications: { types: { checklist: false, slip: false, leave_runout: false } } };
  const m = memory({ settings: only, tasks });
  // 20:59 Irish time: not yet
  await runTick(at('2026-07-14T19:59:00Z'), m.store, m.send);
  assertEquals(m.sent.length, 0);
  // 21:00 Irish time = 20:00 UTC in summer
  const r = await runTick(at('2026-07-14T20:00:00Z'), m.store, m.send);
  assertEquals(r.jobs, ['evening_review']);
  assertEquals(m.sent[0], {
    title: 'Evening review',
    body: '2 open tasks today: done, carry over or drop?',
    url: '/review',
    tag: m.nudges[0]?.id,
  });
  // Ticks later that evening (or a second scheduler run) don't repeat it.
  const again = await runTick(at('2026-07-14T20:01:00Z'), m.store, m.send);
  assertEquals(again.jobs, []);
  assertEquals(m.sent.length, 1);

  const ny = memory({ settings: { ...only, time_zone: 'America/New_York' }, tasks });
  await runTick(at('2026-07-14T20:00:00Z'), ny.store, ny.send); // 16:00 in New York
  assertEquals(ny.sent.length, 0);
});

Deno.test('the location checklist goes out the evening before', async () => {
  const only = {
    notifications: { types: { evening_review: false, slip: false, leave_runout: false } },
  };
  // Tue 14 July 20:00 Irish time; Wednesday's usual place is WFH, which has no checklist.
  const wed = memory({ settings: only });
  await runTick(at('2026-07-14T19:00:00Z'), wed.store, wed.send);
  assertEquals(wed.sent.length, 0);
  // With an override to the office for Wednesday, the office list is sent.
  const office = memory({ settings: only, workDays: [{ date: '2026-07-15', location: 'office' }] });
  await runTick(at('2026-07-14T19:00:00Z'), office.store, office.send);
  assertEquals(office.sent[0]?.title, 'Tomorrow: Office');
  assertEquals(office.sent[0]?.body, 'Bring: Laptop, Charger, Pass');
  // Not when tomorrow is leave.
  const leave = memory({
    settings: only,
    workDays: [{ date: '2026-07-15', location: 'office' }],
    leave: [
      {
        start_date: '2026-07-15',
        end_date: '2026-07-15',
        start_half: false,
        end_half: false,
        leave_type: 'annual',
        status: 'approved',
      },
    ],
  });
  await runTick(at('2026-07-14T19:00:00Z'), leave.store, leave.send);
  assertEquals(leave.sent.length, 0);
});

Deno.test('slip nudge in the morning for tasks carried over 3 or more times', async () => {
  const only = {
    notifications: { types: { evening_review: false, checklist: false, leave_runout: false } },
  };
  const m = memory({
    settings: only,
    tasks: [
      { id: 't1', title: 'Renew passport', due_at: null, top3_date: null, carry_count: 3 },
      { id: 't2', title: 'Fine', due_at: null, top3_date: null, carry_count: 1 },
    ],
  });
  await runTick(at('2026-07-14T07:00:00Z'), m.store, m.send); // 08:00 Irish time
  assertEquals(m.sent[0], {
    title: 'Slipping: Renew passport',
    body: 'Carried over 3 times. Do it, reschedule or drop it?',
    url: '/library/item/t1',
    tag: m.nudges[0]?.id,
  });
});

Deno.test(
  'leave run-out warnings about 90, 42 and 14 days before the year ends, once each',
  async () => {
    const only = {
      notifications: { types: { evening_review: false, checklist: false, slip: false } },
    };
    const taken: LeaveRow[] = [
      {
        start_date: '2026-07-13',
        end_date: '2026-07-17',
        start_half: false,
        end_half: false,
        leave_type: 'annual',
        status: 'taken',
      },
    ];
    const m = memory({ settings: only, leave: taken });
    // 1 September: 90 days before 30 November. 21 - 5 = 16 left; 5 carry over, 11 lost.
    await runTick(at('2026-09-01T07:30:00Z'), m.store, m.send);
    assertEquals(m.sent[0]?.title, '16 days of leave left');
    assertEquals(m.sent[0]?.body, '5 carry over, 11 lost on 30 November unless booked.');
    // The next morning: same milestone, nothing new.
    await runTick(at('2026-09-02T07:30:00Z'), m.store, m.send);
    assertEquals(m.sent.length, 1);
    // 42 days before: a second warning.
    await runTick(at('2026-10-19T07:30:00Z'), m.store, m.send);
    assertEquals(m.sent.length, 2);
    // Within the carry-over allowance: no warning.
    const fine = memory({ settings: { ...only, work: { entitlement: 8 } }, leave: taken });
    await runTick(at('2026-11-16T08:30:00Z'), fine.store, fine.send);
    assertEquals(fine.sent.length, 0);
  },
);

Deno.test(
  'recurring events get reminders for their next occurrence, at local time across the clock change',
  async () => {
    const training: RecurringRow = {
      id: 'r1',
      title: 'Training',
      start_at: '2026-10-13T18:00:00.000Z', // Tue 19:00 IST
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      data: {},
    };
    assertEquals(
      occurrencesBetween(
        training,
        at('2026-10-26T00:00:00Z'),
        at('2026-10-28T00:00:00Z'),
        'Europe/Dublin',
      ).map((d) => d.toISOString()),
      ['2026-10-27T19:00:00.000Z'],
    );
    const m = memory({
      settings: quietJobs,
      recurring: [training, { ...training, id: 'r2', data: { reminder_minutes: 'none' } }],
    });
    await runTick(at('2026-10-27T08:00:00Z'), m.store, m.send);
    const planned = m.nudges.filter((x) => x.kind === 'event_reminder');
    assertEquals(
      planned.map((x) => [x.dedupe_key, x.send_at]),
      [['event:r1@2026-10-27T19:00:00.000Z', '2026-10-27T18:30:00.000Z']],
    );
    // Planning again doesn't duplicate.
    await runTick(at('2026-10-27T09:00:00Z'), m.store, m.send);
    assertEquals(m.nudges.filter((x) => x.kind === 'event_reminder').length, 1);
    // An occurrence deleted or changed on its own (Task 11.5) is skipped.
    assertEquals(
      occurrencesBetween(
        { ...training, data: { exdates: ['2026-10-27T19:00:00.000Z'] } },
        at('2026-10-26T00:00:00Z'),
        at('2026-11-04T00:00:00Z'),
        'Europe/Dublin',
      ).map((d) => d.toISOString()),
      ['2026-11-03T19:00:00.000Z'],
    );
  },
);

Deno.test(
  'the morning brief runs once a day at the brief time, in local time (Task 5.6)',
  async () => {
    const runs: string[] = [];
    const only = {
      notifications: {
        types: { evening_review: false, checklist: false, slip: false, leave_runout: false },
      },
    };
    const m = memory({ settings: only });
    const extras = {
      brief: (userId: string, date: string) => {
        runs.push(`${userId} ${date}`);
        return m.store.addNudge(userId, {
          kind: 'morning_brief',
          send_at: '2026-07-15T06:30:00.000Z',
          title: 'Good morning',
          body: 'Top 3: A',
          url: '/today',
          dedupe_key: `brief:${date}`,
        });
      },
    };
    await runTick(at('2026-07-15T06:29:00Z'), m.store, m.send, extras); // 07:29 Irish time
    assertEquals(runs, []);
    const r = await runTick(at('2026-07-15T06:30:00Z'), m.store, m.send, extras);
    assertEquals(r.jobs, ['morning_brief']);
    assertEquals(runs, [`${U} 2026-07-15`]);
    // The round-up it wrote goes out in the same tick.
    assertEquals(
      m.sent.map((s) => s.title),
      ['Good morning'],
    );
    await runTick(at('2026-07-15T06:45:00Z'), m.store, m.send, extras);
    assertEquals(runs.length, 1);

    const off = memory({
      settings: {
        notifications: {
          ...only.notifications,
          types: { ...only.notifications.types, morning_brief: false },
        },
      },
    });
    const offRuns: string[] = [];
    await runTick(at('2026-07-15T06:30:00Z'), off.store, off.send, {
      brief: (u) => {
        offRuns.push(u);
        return Promise.resolve();
      },
    });
    assertEquals(offRuns, []);

    const late = memory({
      settings: { ...only, notifications: { ...only.notifications, brief_time: '09:00' } },
    });
    const lateRuns: string[] = [];
    await runTick(at('2026-07-15T06:30:00Z'), late.store, late.send, {
      brief: (u) => {
        lateRuns.push(u);
        return Promise.resolve();
      },
    });
    assertEquals(lateRuns, []);
  },
);

Deno.test('a failing brief does not stop the rest of the tick', async () => {
  const m = memory({
    settings: quietJobs,
    nudges: [{ title: 'Due now', send_at: '2026-07-15T06:29:00.000Z' }],
  });
  const r = await runTick(at('2026-07-15T06:30:00Z'), m.store, m.send, {
    brief: () => Promise.reject(new Error('boom')),
  });
  assertEquals(
    m.sent.map((s) => s.title),
    ['Due now'],
  );
  assertEquals(r.sent, 1);
});

Deno.test('the weekly review runs on the chosen day and time, once (Task 8.3)', async () => {
  const only = {
    notifications: {
      types: { evening_review: false, checklist: false, slip: false, leave_runout: false },
    },
  };
  const runs: string[] = [];
  const review = (u: string, date: string) => {
    runs.push(`${u} ${date}`);
    return Promise.resolve();
  };
  const m = memory({ settings: only });
  // Saturday 18 July 2026, 19:00 Irish time: not the day.
  await runTick(at('2026-07-18T18:00:00Z'), m.store, m.send, { review });
  assertEquals(runs, []);
  // Sunday 19 July, 18:59 then 19:00 Irish time.
  await runTick(at('2026-07-19T17:59:00Z'), m.store, m.send, { review });
  assertEquals(runs, []);
  const r = await runTick(at('2026-07-19T18:00:00Z'), m.store, m.send, { review });
  assertEquals(r.jobs.includes('weekly_review'), true);
  await runTick(at('2026-07-19T18:30:00Z'), m.store, m.send, { review });
  assertEquals(runs, [`${U} 2026-07-19`]);

  const friday = memory({
    settings: { notifications: { ...only.notifications, review_day: 4, review_time: '17:00' } },
  });
  const fridayRuns: string[] = [];
  await runTick(at('2026-07-17T16:00:00Z'), friday.store, friday.send, {
    review: (u) => {
      fridayRuns.push(u);
      return Promise.resolve();
    },
  });
  assertEquals(fridayRuns, [U]);
});
