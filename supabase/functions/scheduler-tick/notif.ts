/**
 * Notification settings (settings.data.notifications), with defaults (Tasks
 * 4.13 and 4.15). The app's settings screen writes the same shape.
 */
export const NUDGE_TYPES = [
  'event_reminder',
  'task_due',
  'check_time',
  'evening_review',
  'checklist',
  'leave_runout',
  'slip',
  'morning_brief',
] as const;
export type NudgeType = (typeof NUDGE_TYPES)[number];

export interface NotifSettings {
  types: Record<NudgeType, boolean>;
  quiet_start: string;
  quiet_end: string;
  /** Event reminders still arrive during quiet hours. */
  quiet_allows_events: boolean;
  /** Most single notifications a day; extras are bundled into one summary. */
  daily_cap: number;
  evening_review_time: string;
  checklist_time: string;
  morning_time: string;
  /** When the morning brief and its round-up go out. */
  brief_time: string;
  event_reminder_minutes: number;
}

export const DEFAULT_NOTIF: NotifSettings = {
  types: Object.fromEntries(NUDGE_TYPES.map((t) => [t, true])) as Record<NudgeType, boolean>,
  quiet_start: '22:00',
  quiet_end: '07:30',
  quiet_allows_events: true,
  daily_cap: 8,
  evening_review_time: '21:00',
  checklist_time: '20:00',
  morning_time: '08:00',
  brief_time: '07:30',
  event_reminder_minutes: 30,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function readNotif(data: Record<string, unknown> | null | undefined): NotifSettings {
  const n = (data?.notifications ?? {}) as Record<string, unknown>;
  const out: NotifSettings = { ...DEFAULT_NOTIF, types: { ...DEFAULT_NOTIF.types } };
  const t = (n.types ?? {}) as Record<string, unknown>;
  for (const k of NUDGE_TYPES) if (typeof t[k] === 'boolean') out.types[k] = t[k] as boolean;
  for (const k of [
    'quiet_start',
    'quiet_end',
    'evening_review_time',
    'checklist_time',
    'morning_time',
    'brief_time',
  ] as const) {
    if (typeof n[k] === 'string' && HHMM.test(n[k] as string)) out[k] = n[k] as string;
  }
  if (typeof n.quiet_allows_events === 'boolean') out.quiet_allows_events = n.quiet_allows_events;
  if (
    Number.isInteger(n.daily_cap) &&
    (n.daily_cap as number) >= 1 &&
    (n.daily_cap as number) <= 50
  )
    out.daily_cap = n.daily_cap as number;
  if (Number.isInteger(n.event_reminder_minutes) && (n.event_reminder_minutes as number) >= 0)
    out.event_reminder_minutes = n.event_reminder_minutes as number;
  return out;
}

/** Quiet hours may span midnight (22:00–07:30). Equal times mean no quiet hours. */
export function inQuietHours(
  hhmm: string,
  s: Pick<NotifSettings, 'quiet_start' | 'quiet_end'>,
): boolean {
  if (s.quiet_start === s.quiet_end) return false;
  return s.quiet_start < s.quiet_end
    ? hhmm >= s.quiet_start && hhmm < s.quiet_end
    : hhmm >= s.quiet_start || hhmm < s.quiet_end;
}

/** Local date, time and weekday of an instant. */
export function localNow(now: Date, tz: string): { date: string; hhmm: string; weekday: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
    weekday: days.indexOf(p.weekday as string),
  };
}

/** The instant of local midnight on a date (for "sent today" counts). */
export function localMidnightIso(date: string, tz: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const local = localNow(guess, tz);
  const [h, m] = local.hhmm.split(':').map(Number) as [number, number];
  const shift = local.date === date ? h * 60 + m : h * 60 + m - 1440;
  return new Date(guess.getTime() - shift * 60_000).toISOString();
}

/** A local wall time on a date as an instant (correct on clock-change days). */
export function localTimeIso(date: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const want = h * 60 + m;
  const guess = new Date(Date.parse(localMidnightIso(date, tz)) + want * 60_000);
  const got = localNow(guess, tz).hhmm.split(':').map(Number) as [number, number];
  return new Date(guess.getTime() + (want - (got[0] * 60 + got[1])) * 60_000).toISOString();
}
