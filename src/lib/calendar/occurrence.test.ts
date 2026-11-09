import { describe, expect, it } from 'vitest';
import { newItem } from '../db/repository';
import type { Item } from '../schemas/records';
import {
  endBefore,
  makeShift,
  planDelete,
  planEdit,
  remainingRule,
  shiftByDay,
  withExdate,
} from './occurrence';
import { expandOccurrences } from './sources';

const TZ = 'Europe/Dublin';
const U = '11111111-1111-4111-8111-111111111111';
// Quiz: Thursdays 20:00–23:00 Dublin from 15 Oct 2026 (summer time, +1).
const quiz = (fields: Partial<Item> = {}): Item =>
  newItem(U, {
    id: '22222222-2222-4222-8222-000000000001',
    type: 'event',
    title: 'Quiz',
    calendar: 'personal',
    start_at: '2026-10-15T19:00:00.000Z',
    end_at: '2026-10-15T22:00:00.000Z',
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    data: { location: 'The Local' },
    ...fields,
  });
const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') };
const occ = (item: Item) => expandOccurrences(item, range, TZ);
// After the clock change: Thursdays at 20:00 GMT.
const NOV_5 = '2026-11-05T20:00:00.000Z';
const NOV_12 = '2026-11-12T20:00:00.000Z';

describe('repeating events: exceptions and expansion (Task 11.5)', () => {
  it('an exception removes that occurrence only, at local time across the clock change', () => {
    const all = occ(quiz());
    expect(all).toContain(NOV_5);
    const item = quiz({ data: { exdates: withExdate(quiz(), NOV_5) } });
    expect(occ(item)).toEqual(all.filter((o) => o !== NOV_5));
    // Written once, as plain UTC, whatever form it came in.
    expect(withExdate(item, '2026-11-05T20:00:00+00:00')).toEqual([NOV_5]);
  });

  it('a rule ended the day before an occurrence stops just before it', () => {
    const rule = endBefore('FREQ=WEEKLY;BYDAY=TH;COUNT=20', NOV_12, TZ);
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261111T235959Z');
    expect(occ(quiz({ rrule: rule })).at(-1)).toBe(NOV_5);
  });

  it('a COUNT rule continues with what is left; weekly days move with the event', () => {
    expect(remainingRule(quiz(), 'FREQ=WEEKLY;COUNT=10', NOV_12, TZ)).toBe('FREQ=WEEKLY;COUNT=6');
    expect(shiftByDay('FREQ=WEEKLY;BYDAY=TH', 1)).toBe('FREQ=WEEKLY;BYDAY=FR');
    expect(shiftByDay('FREQ=WEEKLY;BYDAY=MO,SU', 1)).toBe('FREQ=WEEKLY;BYDAY=MO,TU');
    expect(shiftByDay('FREQ=DAILY', 1)).toBe('FREQ=DAILY');
  });

  it('a move keeps wall-clock time on other dates', () => {
    // Moved from Thu 5 Nov 20:00 to Fri 6 Nov 21:00: an October date moves to Fri 21:00 summer time.
    const s = makeShift(NOV_5, '2026-11-06T21:00:00.000Z', false, TZ);
    expect(s.days).toBe(1);
    expect(s.apply('2026-10-15T19:00:00.000Z')).toBe('2026-10-16T20:00:00.000Z');
    expect(makeShift(NOV_5, NOV_5, false, TZ).same).toBe(true);
  });
});

describe('delete one occurrence', () => {
  const override = newItem(U, {
    type: 'event',
    title: 'Quiz (final)',
    start_at: '2026-11-19T21:00:00.000Z',
    data: { parent_id: quiz().id, recurrence_id: '2026-11-19T20:00:00.000Z' },
  });

  it('this event: an exception', () => {
    const p = planDelete(quiz(), NOV_5, 'this', [], TZ);
    expect(p.series).toEqual({ data: { location: 'The Local', exdates: [NOV_5] } });
    expect(p.remove).toEqual([]);
  });

  it('this and following: the series ends the day before; later changed ones go too', () => {
    const p = planDelete(quiz(), NOV_12, 'following', [override], TZ);
    expect(p.series?.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261111T235959Z');
    expect(p.remove).toEqual([override.id]);
  });

  it('all events, or this and following from the first: the series and its changed ones', () => {
    for (const p of [
      planDelete(quiz(), NOV_5, 'all', [override], TZ),
      planDelete(quiz(), '2026-10-15T19:00:00.000Z', 'following', [override], TZ),
    ]) {
      expect(p.series?.deleted_at).toBeTruthy();
      expect(p.remove).toEqual([override.id]);
    }
  });
});

describe('edit one occurrence', () => {
  const moved = {
    title: 'Quiz (Christmas)',
    start_at: '2026-11-12T21:00:00.000Z',
    end_at: '2026-11-13T00:00:00.000Z',
    all_day: false,
  };

  it('this event: an exception plus a one-off linked to the series', () => {
    const p = planEdit(quiz(), NOV_12, 'this', moved, [], TZ);
    expect(p.series).toEqual({ data: { location: 'The Local', exdates: [NOV_12] } });
    expect(p.create).toEqual([
      expect.objectContaining({
        title: 'Quiz (Christmas)',
        start_at: '2026-11-12T21:00:00.000Z',
        rrule: null,
        calendar: 'personal',
        data: { location: 'The Local', parent_id: quiz().id, recurrence_id: NOV_12 },
      }),
    ]);
  });

  it('this and following: the old rule gets UNTIL, a new series starts at the occurrence', () => {
    const s = quiz({
      data: { location: 'The Local', exdates: [NOV_5, '2026-11-26T20:00:00.000Z'] },
    });
    const later = newItem(U, {
      type: 'event',
      title: 'Quiz (final)',
      data: { parent_id: s.id, recurrence_id: '2026-11-19T20:00:00.000Z' },
    });
    const p = planEdit(s, NOV_12, 'following', moved, [later], TZ);
    expect(p.series).toEqual({
      rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261111T235959Z',
      data: { location: 'The Local', exdates: [NOV_5] },
    });
    const next = p.create[0];
    expect(next).toMatchObject({
      title: 'Quiz (Christmas)',
      start_at: '2026-11-12T21:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      // Later exceptions move to the new series, at its new time.
      data: { location: 'The Local', exdates: ['2026-11-26T21:00:00.000Z'] },
    });
    expect(p.update).toEqual([
      {
        id: later.id,
        changes: { data: { parent_id: next?.id, recurrence_id: '2026-11-19T21:00:00.000Z' } },
      },
    ]);
    const old = { ...s, ...p.series } as Item;
    expect(occ(old).at(-1)).toBe('2026-10-29T20:00:00.000Z');
  });

  it('all events: the series moves by the same days and to the new time of day', () => {
    const s = quiz({ data: { location: 'The Local', exdates: [NOV_5] } });
    const p = planEdit(
      s,
      NOV_12,
      'all',
      { ...moved, start_at: '2026-11-13T21:00:00.000Z', end_at: '2026-11-14T00:00:00.000Z' },
      [],
      TZ,
    );
    expect(p.series).toMatchObject({
      title: 'Quiz (Christmas)',
      start_at: '2026-10-16T20:00:00.000Z',
      end_at: '2026-10-16T23:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      data: { location: 'The Local', exdates: ['2026-11-06T21:00:00.000Z'] },
    });
    expect(p.create).toEqual([]);
  });

  it('a changed repeat with "this and following" is used as it is', () => {
    const p = planEdit(quiz(), NOV_12, 'following', { ...moved, rrule: 'FREQ=DAILY' }, [], TZ);
    expect(p.create[0]?.rrule).toBe('FREQ=DAILY');
  });
});
