import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { baseRecord } from '../db/repository';
import { setWorkLocation, workDayId } from '../db/workDays';
import type { LeaveBooking } from '../schemas/records';
import { locationsBy, mondayOf } from './locationStats';
import { DEFAULT_WORK_SETTINGS } from './settings';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-location`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('work-day ids', () => {
  it('are stable per user and date, valid UUIDs, and differ otherwise', () => {
    const a = workDayId(U, '2026-07-14');
    expect(a).toBe(workDayId(U, '2026-07-14'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(workDayId(U, '2026-07-15')).not.toBe(a);
    expect(workDayId(V, '2026-07-14')).not.toBe(a);
  });
});

describe('setting the location (Task 4.7)', () => {
  it('stores an override, and clears it when set back to the usual place', async () => {
    const day = await setWorkLocation(db, U, '2026-07-14', 'client', 'office');
    expect(day).toMatchObject({
      id: workDayId(U, '2026-07-14'),
      location: 'client',
      deleted_at: null,
    });
    const back = await setWorkLocation(db, U, '2026-07-14', 'office', 'office');
    expect(back.id).toBe(day.id);
    expect(back.deleted_at).not.toBeNull();
    const again = await setWorkLocation(db, U, '2026-07-14', 'wfh', 'office');
    expect(again).toMatchObject({ id: day.id, location: 'wfh', deleted_at: null });
    expect(await db.work_days.count()).toBe(1);
  });
});

describe('days per location', () => {
  const leave: LeaveBooking = {
    ...baseRecord(U),
    start_date: '2026-07-16',
    end_date: '2026-07-17',
    start_half: false,
    end_half: false,
    leave_type: 'annual',
    status: 'taken',
    share_us: false,
    days: 2,
    note: null,
    capture_id: null,
  };
  const data = {
    work: DEFAULT_WORK_SETTINGS, // Office Mon/Tue/Thu, WFH Wed/Fri
    leave: [leave],
    workDays: [{ ...baseRecord(U), date: '2026-07-14', location: 'client' as const, note: null }],
  };

  it('Monday of a week', () => {
    expect(mondayOf('2026-07-19')).toBe('2026-07-13');
    expect(mondayOf('2026-07-13')).toBe('2026-07-13');
  });

  it('counts by week, leaving out weekends', () => {
    expect(locationsBy('week', '2026-07-13', '2026-07-26', data)).toEqual([
      { period: '2026-07-13', counts: { office: 1, client: 1, wfh: 1, off: 2, travel: 0 } },
      { period: '2026-07-20', counts: { office: 3, client: 0, wfh: 2, off: 0, travel: 0 } },
    ]);
  });

  it('counts by month, with the August bank holiday Off', () => {
    const [aug] = locationsBy('month', '2026-08-01', '2026-08-31', data);
    expect(aug?.period).toBe('2026-08');
    expect(aug?.counts.off).toBe(1);
    expect(Object.values(aug?.counts ?? {}).reduce((a, b) => a + b, 0)).toBe(21);
  });
});
