import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import type { CalendarData } from '../../lib/calendar/sources';
import { useDb } from '../../lib/db/context';
import { readWorkSettings } from '../../lib/work/settings';

/** The device's time zone: the calendar shows local wall-clock time. */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Everything the calendar draws, live from the local database. */
export function useCalendarData(): CalendarData | undefined {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  return useLiveQuery(async () => {
    const [items, external, feeds, leave, workDays, settings, series] = await Promise.all([
      db.items.where('type').anyOf(['event', 'task']).toArray(),
      db.external_events.toArray(),
      db.feeds.toArray(),
      db.leave_bookings.toArray(),
      db.work_days.toArray(),
      db.settings.get(userId),
      db.series.toArray(),
    ]);
    return {
      items: items.filter((i) => !i.deleted_at),
      external: external.filter((e) => !e.deleted_at),
      feeds: feeds.filter((f) => !f.deleted_at),
      leave: leave.filter((b) => !b.deleted_at),
      workDays: workDays.filter((w) => !w.deleted_at),
      work: readWorkSettings(settings),
      series: series.filter((s) => !s.deleted_at),
    };
  }, [db, userId]);
}
