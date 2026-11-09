import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEvents } from '../calendar/sources';
import { DEFAULT_WORK_SETTINGS } from '../work/settings';
import { openUserDb, type AirheadDb } from './db';
import { deleteOccurrence, editOccurrence } from './recurring';
import { newItem, save } from './repository';

const U = '11111111-1111-4111-8111-111111111111';
const TZ = 'Europe/Dublin';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-recurring`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

// Swim: Tuesdays 07:00–08:00 Dublin (GMT) from 10 Nov 2026.
const swim = () =>
  save(
    db,
    'items',
    newItem(U, {
      type: 'event',
      title: 'Swim',
      calendar: 'personal',
      start_at: '2026-11-10T07:00:00.000Z',
      end_at: '2026-11-10T08:00:00.000Z',
      rrule: 'FREQ=WEEKLY',
    }),
  );
const shown = async () => {
  const items = await db.items.toArray();
  return buildEvents(
    { items, external: [], feeds: [], leave: [], workDays: [], work: DEFAULT_WORK_SETTINGS },
    { start: new Date('2026-11-09T00:00:00Z'), end: new Date('2026-12-08T00:00:00Z') },
    TZ,
  )
    .filter((e) => e.extendedProps.itemId)
    .map((e) => `${e.start.slice(5, 16)} ${e.title}`)
    .sort();
};
const slot = (start: string, hours = 1) => ({
  start_at: start,
  end_at: new Date(Date.parse(start) + hours * 3_600_000).toISOString(),
  all_day: false,
});

describe('repeating events in the database (Task 11.5)', () => {
  it('delete one, change another: the rest are untouched and each row goes to the outbox', async () => {
    const s = await swim();
    const before = await db.outbox.count();
    await deleteOccurrence(db, s, '2026-11-17T07:00:00.000Z', 'this', TZ);
    const fresh = await db.items.get(s.id);
    if (!fresh) throw new Error('series gone');
    await editOccurrence(
      db,
      fresh,
      '2026-11-24T07:00:00.000Z',
      'this',
      { title: 'Swim (gala)', ...slot('2026-11-24T09:00:00.000Z', 2) },
      TZ,
    );
    expect(await shown()).toEqual([
      '11-10T07:00 Swim',
      '11-24T09:00 Swim (gala)',
      '12-01T07:00 Swim',
    ]);
    // Exception, exception again, and the one-off.
    expect(await db.outbox.count()).toBe(before + 3);
  });

  it('this and following, then delete all: the old half and its changes go, the new half stays', async () => {
    const s = await swim();
    const [next] = await editOccurrence(
      db,
      s,
      '2026-11-24T07:00:00.000Z',
      'following',
      { title: 'Swim', ...slot('2026-11-24T08:00:00.000Z') },
      TZ,
    );
    expect(await shown()).toEqual([
      '11-10T07:00 Swim',
      '11-17T07:00 Swim',
      '11-24T08:00 Swim',
      '12-01T08:00 Swim',
    ]);
    if (!next) throw new Error('no new series');
    await deleteOccurrence(db, next, '2026-12-01T08:00:00.000Z', 'this', TZ);
    const old = await db.items.get(s.id);
    if (!old) throw new Error('series gone');
    await deleteOccurrence(db, old, '2026-11-10T07:00:00.000Z', 'all', TZ);
    expect(await shown()).toEqual(['11-24T08:00 Swim']);
  });
});
