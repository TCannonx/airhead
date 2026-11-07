import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import type { LeaveBooking } from '../../lib/schemas/records';
import { readWorkSettings, type WorkSettings } from '../../lib/work/settings';

/** Work settings and every live leave booking, from the local database. */
export function useWork(): { work: WorkSettings; bookings: LeaveBooking[] } | undefined {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  return useLiveQuery(async () => {
    const [settings, bookings] = await Promise.all([
      db.settings.get(userId),
      db.leave_bookings.orderBy('start_date').toArray(),
    ]);
    return { work: readWorkSettings(settings), bookings: bookings.filter((b) => !b.deleted_at) };
  }, [db, userId]);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Today's date on this device, YYYY-MM-DD. */
export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
