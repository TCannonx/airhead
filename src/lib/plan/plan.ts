import type { Nudge, SettingsRow } from '../schemas/records';

/** Planner nudge kinds (Task 13.2), in the words the app shows. */
export const PLAN_KIND_LABELS: Record<string, string> = {
  prepare: 'Get ready',
  leave: 'Time to leave',
  do: 'Do it',
  follow_up: 'Follow up',
  reading: 'Read',
};

/** Where a nudge's timing came from (Task 13.8 "Why now?"). */
export function sourceLabel(source: Nudge['source']): string {
  switch (source) {
    case 'default':
      return 'Airhead’s defaults';
    case 'ai':
      return 'Planned by AI';
    case 'user':
      return 'You';
    default:
      return 'Your reminder';
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function atLocal(base: Date, hhmm: string, addDays = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  d.setHours(h, m, 0, 0);
  return d;
}

export interface SnoozeChoice {
  label: string;
  at: Date;
}

/**
 * The snooze sheet's quick choices (device time): in an hour; this evening at
 * the prepare-evening time (while it is still ahead); tomorrow morning at the
 * brief time.
 */
export function snoozeChoices(now: Date, settings: SettingsRow | undefined | null): SnoozeChoice[] {
  const plan = (settings?.data.plan ?? {}) as { prepare_evening_time?: unknown };
  const notif = (settings?.data.notifications ?? {}) as { brief_time?: unknown };
  const evening =
    typeof plan.prepare_evening_time === 'string' && HHMM.test(plan.prepare_evening_time)
      ? plan.prepare_evening_time
      : '20:30';
  const morning =
    typeof notif.brief_time === 'string' && HHMM.test(notif.brief_time)
      ? notif.brief_time
      : '07:30';
  const out: SnoozeChoice[] = [{ label: 'In an hour', at: new Date(now.getTime() + 3_600_000) }];
  const tonight = atLocal(now, evening);
  if (tonight.getTime() - now.getTime() > 15 * 60_000)
    out.push({ label: 'This evening', at: tonight });
  out.push({ label: 'Tomorrow morning', at: atLocal(now, morning, 1) });
  return out;
}

/** "Tue 20:30" for an instant, in device time. */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
