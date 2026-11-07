import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { leaveBridges } from '../../lib/leave/suggest';
import { readWorkSettings } from '../../lib/work/settings';
import { todayKey } from '../leave/useWork';

/**
 * In the weekly review (Task 8.8): when a good bridge (4+ days off for one
 * leave day) falls in the next 8 weeks, say so and link to Work. Code only.
 */
export default function BridgeHint() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const top = useLiveQuery(async () => {
    const [settings, bookings, events, external] = await Promise.all([
      db.settings.get(userId),
      db.leave_bookings.toArray(),
      db.items.where('type').equals('event').toArray(),
      db.external_events.toArray(),
    ]);
    const bridges = leaveBridges(
      {
        work: readWorkSettings(settings),
        bookings: bookings.filter((b) => !b.deleted_at),
        events,
        external,
        today: todayKey(),
        weeks: 8,
      },
      3,
    );
    return bridges.find((b) => b.leave.length === 1) ?? null;
  }, [db, userId]);
  if (!top) return null;
  return (
    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      A good bridge is coming up: one day off on {top.leave[0]} gives {top.daysOff} days in a row.{' '}
      <Link to="/work" className="font-semibold underline">
        Plan it
      </Link>
    </p>
  );
}
