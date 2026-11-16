import { assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  drainPlanQueue,
  matchesPrepRule,
  type PlanNudgeWrite,
  type PlanQueueStore,
  type QueuedItem,
} from './plan.ts';

const U = 'u1';
const NOW = new Date('2026-11-17T12:00:00Z'); // Tuesday, GMT

function item(over: Partial<QueuedItem> = {}): QueuedItem {
  return {
    id: 'i1',
    user_id: U,
    type: 'event',
    title: 'Training',
    status: 'open',
    all_day: false,
    start_at: '2026-11-18T08:00:00Z',
    due_at: null,
    rrule: null,
    deleted_at: null,
    data: {},
    ...over,
  };
}

function fakeStore(items: QueuedItem[], pending: { key: string; source: string }[] = []) {
  const written: PlanNudgeWrite[] = [];
  const cancelled: string[] = [];
  let dequeued: string[] = [];
  const store: PlanQueueStore = {
    queued: () => Promise.resolve(items.map((i) => i.id)),
    items: () => Promise.resolve(items),
    settings: () => Promise.resolve({ time_zone: 'Europe/Dublin' }),
    prep: () => Promise.resolve([]),
    pendingKeys: () => Promise.resolve(pending),
    upsert: (_u, n) => {
      written.push(n);
      return Promise.resolve();
    },
    cancel: (_u, key) => {
      cancelled.push(key);
      return Promise.resolve();
    },
    dequeue: (ids) => {
      dequeued = ids;
      return Promise.resolve();
    },
  };
  return { store, written, cancelled, dequeued: () => dequeued };
}

Deno.test(
  'an event tomorrow at 08:00 gets a prepare at 20:30 tonight and a leave at 07:20, keyed by date',
  async () => {
    const f = fakeStore([item()]);
    const r = await drainPlanQueue(NOW, f.store);
    assertEquals(
      f.written.map((n) => [n.key, n.send_at]),
      [
        ['plan:prepare:i1:2026-11-18', '2026-11-17T20:30:00.000Z'],
        ['plan:leave:i1:2026-11-18', '2026-11-18T07:20:00.000Z'],
      ],
    );
    assertEquals(r, { items: 1, written: 2, cancelled: 0 });
    assertEquals(f.dequeued(), ['i1']);
    assertEquals(f.written[0]?.url, '/library/item/i1');
    assertEquals(f.written[0]?.reason.length! > 0, true);
  },
);

Deno.test('a repeating event gets nudges for each occurrence in the next 8 days', async () => {
  const f = fakeStore([item({ start_at: '2026-11-11T08:00:00Z', rrule: 'FREQ=WEEKLY;BYDAY=WE' })]);
  await drainPlanQueue(NOW, f.store);
  assertEquals(
    f.written.filter((n) => n.kind === 'leave').map((n) => n.key),
    ['plan:leave:i1:2026-11-18', 'plan:leave:i1:2026-11-25'],
  );
});

Deno.test(
  'a moved event cancels the old date and keeps AI nudges only for live dates',
  async () => {
    const f = fakeStore(
      [item({ start_at: '2026-11-19T15:00:00Z' })],
      [
        { key: 'plan:prepare:i1:2026-11-18', source: 'default' },
        { key: 'plan:leave:i1:2026-11-18', source: 'ai' },
        { key: 'plan:do:i1:2026-11-19', source: 'ai' },
        { key: 'plan:prepare:i1:2026-11-19', source: 'default' },
      ],
    );
    await drainPlanQueue(NOW, f.store);
    assertEquals(f.cancelled.sort(), ['plan:leave:i1:2026-11-18', 'plan:prepare:i1:2026-11-18']);
  },
);

Deno.test('a deleted or done item loses every pending plan nudge', async () => {
  for (const over of [{ deleted_at: '2026-11-17T11:00:00Z' }, { status: 'done' }]) {
    const f = fakeStore(
      [item(over)],
      [
        { key: 'plan:prepare:i1:2026-11-18', source: 'ai' },
        { key: 'plan:leave:i1:2026-11-18', source: 'default' },
      ],
    );
    await drainPlanQueue(NOW, f.store);
    assertEquals(f.written, []);
    assertEquals(f.cancelled.length, 2);
  }
});

Deno.test(
  'a task with a due time gets a do nudge; one beyond 8 days or in the past gets none',
  async () => {
    const task = item({ type: 'task', start_at: null, due_at: '2026-11-18T15:00:00Z' });
    const f = fakeStore([
      task,
      { ...task, id: 'i2', due_at: '2026-12-30T15:00:00Z' },
      { ...task, id: 'i3', due_at: '2026-11-16T15:00:00Z' },
    ]);
    await drainPlanQueue(NOW, f.store);
    assertEquals(
      f.written.map((n) => n.key),
      ['plan:do:i1:2026-11-18'],
    );
  },
);

Deno.test('an all-day event with a matching prep rule is prepared the evening before', async () => {
  const f = fakeStore([item({ all_day: true, start_at: '2026-11-19T00:00:00Z', title: 'Barber' })]);
  f.store.settings = () =>
    Promise.resolve({ work: { prep_rules: [{ id: 'r', match: ['barber'], reminder: 'Cash' }] } });
  await drainPlanQueue(NOW, f.store);
  assertEquals(
    f.written.map((n) => n.key),
    ['plan:prepare:i1:2026-11-19'],
  );
});

Deno.test('an empty queue does nothing', async () => {
  const f = fakeStore([]);
  assertEquals(await drainPlanQueue(NOW, f.store), { items: 0, written: 0, cancelled: 0 });
});

Deno.test('prep rules match by word in the title, ignoring case and short words', () => {
  const s = { work: { prep_rules: [{ match: ['Haircut', 'x'] }] } };
  assertEquals(matchesPrepRule('haircut at 3', s), true);
  assertEquals(matchesPrepRule('Box', s), false);
  assertEquals(matchesPrepRule('anything', {}), false);
});
