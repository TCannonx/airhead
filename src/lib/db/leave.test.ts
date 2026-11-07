import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SETTINGS } from '../work/settings';
import { captureChip, createCapture } from './captures';
import { openUserDb, type AirheadDb } from './db';
import { deleteLeave, leaveRangeText, saveLeave } from './leave';

const USER = '11111111-1111-4111-8111-111111111111';
const W = DEFAULT_WORK_SETTINGS;
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${USER}-leave`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const fields = {
  start_date: '2026-04-06',
  end_date: '2026-04-10',
  start_half: false,
  end_half: false,
  leave_type: 'annual',
  status: 'approved' as const,
  share_us: true,
};

describe('leave bookings (Task 4.6)', () => {
  it('caches the working days a booking costs and queues it for sync', async () => {
    const b = await saveLeave(db, USER, fields, W);
    expect(b.days).toBe(4); // Easter Monday week
    expect(await db.outbox.where('row_id').equals(b.id).count()).toBe(1);
  });

  it('updates in place, recomputing the days', async () => {
    const b = await saveLeave(db, USER, fields, W);
    const again = await saveLeave(db, USER, { ...fields, end_date: '2026-04-08' }, W, b);
    expect(again.id).toBe(b.id);
    expect(again.days).toBe(2);
    expect(await db.leave_bookings.count()).toBe(1);
  });

  it('a one-day half day is half at one end only; an end before the start is clamped', async () => {
    const one = await saveLeave(
      db,
      USER,
      {
        ...fields,
        start_date: '2026-07-14',
        end_date: '2026-07-14',
        start_half: true,
        end_half: true,
      },
      W,
    );
    expect(one).toMatchObject({ start_half: true, end_half: false, days: 0.5 });
    const clamp = await saveLeave(
      db,
      USER,
      { ...fields, start_date: '2026-07-14', end_date: '2026-07-10' },
      W,
    );
    expect(clamp).toMatchObject({ end_date: '2026-07-14', days: 1 });
  });

  it('deleting is a soft delete', async () => {
    const b = await saveLeave(db, USER, fields, W);
    await deleteLeave(db, b.id);
    expect((await db.leave_bookings.get(b.id))?.deleted_at).toBeTruthy();
  });

  it('formats date ranges', () => {
    expect(leaveRangeText({ start_date: '2026-07-14', end_date: '2026-07-14' })).toBe(
      '14 Jul 2026',
    );
    expect(leaveRangeText({ start_date: '2026-07-14', end_date: '2026-07-18' })).toBe(
      '14 Jul – 18 Jul 2026',
    );
    expect(leaveRangeText({ start_date: '2026-12-22', end_date: '2027-01-02' })).toBe(
      '22 Dec 2026 – 2 Jan 2027',
    );
  });
});

describe('the "AL 14–18 July" capture rule', () => {
  it('proposes a booking instead of creating an event', async () => {
    const { capture, event } = await createCapture(
      db,
      USER,
      { text: 'AL 14–18 July' },
      { now: new Date('2026-06-10T09:00:00Z') },
    );
    expect(event).toBeNull();
    expect(capture.status).toBe('sorted');
    expect(capture.payload.leave_proposal).toEqual({
      start_date: '2026-07-14',
      end_date: '2026-07-18',
      start_half: false,
      end_half: false,
      leave_type: 'annual',
    });
    expect(captureChip(capture)).toBe('Leave to book (Today)');
    expect(await db.items.count()).toBe(0);
  });

  it('ordinary dated captures still become events', async () => {
    const { event } = await createCapture(
      db,
      USER,
      { text: 'Dentist 14 July 3pm' },
      { now: new Date('2026-06-10T09:00:00Z') },
    );
    expect(event?.type).toBe('event');
  });
});
