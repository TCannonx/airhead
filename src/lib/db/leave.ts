import { countLeaveDays } from '../leave/engine';
import type { LeaveBooking } from '../schemas/records';
import type { WorkSettings } from '../work/settings';
import type { AirheadDb } from './db';
import { baseRecord, save, softDelete } from './repository';

export type LeaveFields = Pick<
  LeaveBooking,
  'start_date' | 'end_date' | 'start_half' | 'end_half' | 'leave_type' | 'status' | 'share_us'
> &
  Partial<Pick<LeaveBooking, 'note' | 'capture_id'>>;

/**
 * Creates or updates a leave booking (Task 4.6). The working days it costs are
 * worked out on the device and cached on the row for the server's SQL jobs.
 */
export async function saveLeave(
  db: AirheadDb,
  userId: string,
  fields: LeaveFields,
  work: WorkSettings,
  existing?: LeaveBooking,
): Promise<LeaveBooking> {
  const end = fields.end_date < fields.start_date ? fields.start_date : fields.end_date;
  const row: LeaveBooking = {
    ...(existing ?? { ...baseRecord(userId), note: null, capture_id: null }),
    ...fields,
    end_date: end,
    // A one-day booking can't be half at both ends.
    end_half: fields.start_date === end && fields.start_half ? false : fields.end_half,
    days: countLeaveDays({ ...fields, end_date: end }, work),
  };
  return save(db, 'leave_bookings', row);
}

export const deleteLeave = (db: AirheadDb, id: string) => softDelete(db, 'leave_bookings', id);

/** Dates covered by a booking, "14 Jul" or "14 – 18 Jul 2026" style. */
export function leaveRangeText(b: Pick<LeaveBooking, 'start_date' | 'end_date'>): string {
  const fmt = (d: string, withYear: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  if (b.start_date === b.end_date) return fmt(b.start_date, true);
  return `${fmt(b.start_date, b.start_date.slice(0, 4) !== b.end_date.slice(0, 4))} – ${fmt(b.end_date, true)}`;
}
