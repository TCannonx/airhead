import { TZDate } from '@date-fns/tz';
import { format, isSameDay } from 'date-fns';
import { DEFAULT_TIME_ZONE } from '../../lib/rules';
import type { SyncStatus } from '../../lib/sync/types';

export function syncLabel(s: SyncStatus): string {
  const waiting = `${s.pending} waiting`;
  switch (s.state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return s.pending ? `Offline · ${waiting}` : 'Offline';
    case 'error':
      return s.pending ? `${waiting} · will retry` : 'Not synced yet · will retry';
    default:
      return s.pending ? waiting : 'Synced';
  }
}

export function lastSyncedText(
  iso: string | null,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return 'Never';
  const at = new TZDate(iso, timeZone);
  return isSameDay(at, new TZDate(now, timeZone))
    ? `Today at ${format(at, 'HH:mm')}`
    : format(at, "EEE d MMM 'at' HH:mm");
}
