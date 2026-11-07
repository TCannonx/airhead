import rrule from 'npm:rrule@2.8.1';
import { addDays, weekday } from '../_shared/holidays/easter.ts';
import { holidaysBetween } from '../_shared/holidays/ie.ts';
import { balanceFor, leaveYearFor } from '../_shared/leave/engine.ts';
import {
  patternLocation,
  readWork,
  type LeaveBooking,
  type WorkLocation,
} from '../_shared/leave/work.ts';
import type { PushPayload } from '../_shared/push.ts';
import { inQuietHours, localMidnightIso, localNow, readNotif, type NudgeType } from './notif.ts';

/**
 * One scheduler tick (Task 4.13), run every minute: plan reminders for
 * recurring events, run each person's local-time jobs once a day (guarded by
 * job_runs), then send due nudges with quiet hours and the daily cap.
 */
export interface Nudge {
  id: string;
  kind: string;
  send_at: string;
  title: string;
  body: string | null;
  url: string | null;
}
export interface NewNudge {
  kind: string;
  item_id?: string | null;
  send_at: string;
  title: string;
  body: string;
  url: string;
  dedupe_key: string;
}
export interface TaskRow {
  id: string;
  title: string;
  due_at: string | null;
  top3_date: string | null;
  carry_count: number;
}
export interface RecurringRow {
  id: string;
  title: string;
  start_at: string;
  rrule: string;
  data: Record<string, unknown>;
}
export interface LeaveRow extends LeaveBooking {
  deleted_at?: string | null;
}
export interface WorkDayRow {
  date: string;
  location: WorkLocation;
}

export interface TickStore {
  /** People with a device that receives notifications, with their settings.data. */
  users(): Promise<{ user_id: string; settings: Record<string, unknown> }[]>;
  due(userId: string, now: string): Promise<Nudge[]>;
  /** Single notifications (not bundled) sent since an instant. */
  sentSince(userId: string, since: string): Promise<number>;
  lastSummaryAt(userId: string): Promise<string | null>;
  /** Inserts a pending nudge unless one with the same key exists. */
  addNudge(userId: string, n: NewNudge): Promise<void>;
  /** Records a summary notification that was sent. */
  logSent(userId: string, n: NewNudge): Promise<void>;
  setStatus(
    ids: string[],
    status: 'sent' | 'cancelled' | 'bundled' | 'failed',
    at: string,
  ): Promise<void>;
  claimJob(userId: string, job: string, localDate: string): Promise<boolean>;
  openTasks(userId: string): Promise<TaskRow[]>;
  recurringEvents(userId: string): Promise<RecurringRow[]>;
  leave(userId: string): Promise<LeaveRow[]>;
  workDays(userId: string): Promise<WorkDayRow[]>;
}

/** Sends to the person's notification device(s): 'sent', or 'none' when nothing received it. */
export type Sender = (userId: string, p: PushPayload) => Promise<'sent' | 'none'>;

export interface TickReport {
  sent: number;
  deferred: number;
  bundled: number;
  cancelled: number;
  jobs: string[];
}

// rrule ships CommonJS; Deno exposes it as the default export.
const { RRule } = rrule;

const STALE_MS: Record<string, number> = { event_reminder: 2 * 3_600_000 };
const DEFAULT_STALE = 12 * 3_600_000;
const SUMMARY_GAP_MS = 60 * 60_000;
const LOOKAHEAD_MS = 26 * 3_600_000;

function locationFor(
  date: string,
  work: ReturnType<typeof readWork>,
  leave: LeaveRow[],
  days: WorkDayRow[],
): WorkLocation {
  if (
    leave.some(
      (b) =>
        !b.deleted_at && b.start_date <= date && b.end_date >= date && !b.start_half && !b.end_half,
    )
  )
    return 'off';
  const d = days.find((x) => x.date === date);
  if (d) return d.location;
  if (
    holidaysBetween(date, date, work.manual_holidays).some((h) => h.kind !== 'common') ||
    work.closure_days.includes(date)
  )
    return 'off';
  return patternLocation(work, weekday(date));
}

const LABELS: Record<WorkLocation, string> = {
  wfh: 'WFH',
  office: 'Office',
  client: 'Client site',
  travel: 'Travel',
  off: 'Off',
};

/** Next occurrences of a recurring event in (from, to], in the person's time zone. */
export function occurrencesBetween(e: RecurringRow, from: Date, to: Date, tz: string): Date[] {
  const s = localNow(new Date(e.start_at), tz);
  const [h, m] = s.hhmm.split(':').map(Number) as [number, number];
  const [y, mo, d] = s.date.split('-').map(Number) as [number, number, number];
  let options;
  try {
    options = RRule.parseString(e.rrule.replace(/^RRULE:/, ''));
  } catch {
    return [];
  }
  const rule = new RRule({ ...options, dtstart: new Date(Date.UTC(y, mo - 1, d, h, m)) });
  // Floating local times: find candidates around the window, then convert each to an instant.
  const pad = 36 * 3_600_000;
  return rule
    .between(new Date(from.getTime() - pad), new Date(to.getTime() + pad), true)
    .map((o) => {
      const date = o.toISOString().slice(0, 10);
      const wall = o.toISOString().slice(11, 16);
      const midnight = Date.parse(localMidnightIso(date, tz));
      const guess = new Date(
        midnight + (Number(wall.slice(0, 2)) * 60 + Number(wall.slice(3, 5))) * 60_000,
      );
      const got = localNow(guess, tz).hhmm;
      const diff =
        Number(wall.slice(0, 2)) * 60 +
        Number(wall.slice(3, 5)) -
        (Number(got.slice(0, 2)) * 60 + Number(got.slice(3, 5)));
      return new Date(guess.getTime() + diff * 60_000);
    })
    .filter((t) => t > from && t <= to);
}

export async function runTick(now: Date, store: TickStore, send: Sender): Promise<TickReport> {
  const report: TickReport = { sent: 0, deferred: 0, bundled: 0, cancelled: 0, jobs: [] };
  const nowIso = now.toISOString();

  for (const u of await store.users()) {
    const tz = typeof u.settings.time_zone === 'string' ? u.settings.time_zone : 'Europe/Dublin';
    const notif = readNotif(u.settings);
    const local = localNow(now, tz);
    const job = async (name: string, at: string) =>
      local.hhmm >= at && (await store.claimJob(u.user_id, name, local.date));

    // 1. Recurring events: reminders for occurrences in the next day or so.
    for (const e of await store.recurringEvents(u.user_id)) {
      const raw = e.data.reminder_minutes;
      if (raw === 'none') continue;
      const minutes =
        typeof raw === 'string' && /^\d{1,4}$/.test(raw)
          ? Number(raw)
          : notif.event_reminder_minutes;
      for (const occ of occurrencesBetween(e, now, new Date(now.getTime() + LOOKAHEAD_MS), tz)) {
        const at = new Date(occ.getTime() - minutes * 60_000);
        if (at <= now) continue;
        await store.addNudge(u.user_id, {
          kind: 'event_reminder',
          item_id: e.id,
          send_at: at.toISOString(),
          title: e.title,
          body: `${minutes === 0 ? 'Now' : `In ${minutes} min`} · ${localNow(occ, tz).hhmm}`,
          url: '/calendar',
          dedupe_key: `event:${e.id}@${occ.toISOString()}`,
        });
      }
    }

    // 2. Local-time jobs, once per local day each.
    if (notif.types.evening_review && (await job('evening_review', notif.evening_review_time))) {
      report.jobs.push('evening_review');
      const tasks = (await store.openTasks(u.user_id)).filter(
        (t) =>
          t.top3_date === local.date ||
          (t.due_at !== null && localNow(new Date(t.due_at), tz).date <= local.date),
      );
      if (tasks.length) {
        await store.addNudge(u.user_id, {
          kind: 'evening_review',
          send_at: nowIso,
          title: 'Evening review',
          body: `${tasks.length} open task${tasks.length === 1 ? '' : 's'} today: done, carry over or drop?`,
          url: '/review',
          dedupe_key: `evening_review:${local.date}`,
        });
      }
    }

    if (notif.types.checklist && (await job('checklist', notif.checklist_time))) {
      report.jobs.push('checklist');
      const work = readWork(u.settings);
      const tomorrow = addDays(local.date, 1);
      const loc = locationFor(
        tomorrow,
        work,
        await store.leave(u.user_id),
        await store.workDays(u.user_id),
      );
      const items = (work.checklists[loc] ?? []).map((x) => x.trim()).filter(Boolean);
      if (loc !== 'off' && items.length) {
        await store.addNudge(u.user_id, {
          kind: 'checklist',
          send_at: nowIso,
          title: `Tomorrow: ${LABELS[loc]}`,
          body: `Bring: ${items.join(', ')}`,
          url: '/today',
          dedupe_key: `checklist:${tomorrow}`,
        });
      }
    }

    if (notif.types.slip && (await job('slip', notif.morning_time))) {
      report.jobs.push('slip');
      const slipping = (await store.openTasks(u.user_id)).filter((t) => t.carry_count >= 3);
      const [first] = slipping;
      if (first) {
        await store.addNudge(u.user_id, {
          kind: 'slip',
          item_id: slipping.length === 1 ? first.id : null,
          send_at: nowIso,
          title:
            slipping.length === 1
              ? `Slipping: ${first.title}`
              : `${slipping.length} tasks keep slipping`,
          body:
            slipping.length === 1
              ? `Carried over ${first.carry_count} times. Do it, reschedule or drop it?`
              : slipping
                  .slice(0, 4)
                  .map((t) => t.title)
                  .join(', '),
          url: slipping.length === 1 ? `/library/item/${first.id}` : '/today',
          dedupe_key: `slip:${local.date}`,
        });
      }
    }

    if (notif.types.leave_runout && (await job('leave_runout', notif.morning_time))) {
      report.jobs.push('leave_runout');
      const work = readWork(u.settings);
      const year = leaveYearFor(local.date, work);
      const daysLeft = Math.round((Date.parse(year.end) - Date.parse(local.date)) / 86_400_000);
      const milestone = daysLeft <= 14 ? 14 : daysLeft <= 42 ? 42 : daysLeft <= 90 ? 90 : null;
      if (milestone !== null && daysLeft >= 0) {
        const b = balanceFor(year, await store.leave(u.user_id), work, local.date);
        if (b.remaining > work.carry_over_max) {
          const end = new Date(`${year.end}T12:00:00Z`).toLocaleDateString('en-IE', {
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          });
          await store.addNudge(u.user_id, {
            kind: 'leave_runout',
            send_at: nowIso,
            title: `${b.remaining} days of leave left`,
            body: `${Math.min(b.remaining, work.carry_over_max)} carry over, ${b.lose_at_year_end} lost on ${end} unless booked.`,
            url: '/work',
            dedupe_key: `leave_runout:${year.end}:${milestone}`,
          });
        }
      }
    }

    // 3. Send what's due.
    const due = (await store.due(u.user_id, nowIso)).sort((a, b) =>
      a.send_at.localeCompare(b.send_at),
    );
    const cancel: string[] = [];
    const ready: Nudge[] = [];
    for (const n of due) {
      const age = now.getTime() - Date.parse(n.send_at);
      const known = n.kind in notif.types;
      if (
        (known && !notif.types[n.kind as NudgeType]) ||
        age > (STALE_MS[n.kind] ?? DEFAULT_STALE)
      ) {
        cancel.push(n.id);
      } else if (
        inQuietHours(local.hhmm, notif) &&
        !(n.kind === 'event_reminder' && notif.quiet_allows_events)
      ) {
        report.deferred++;
      } else ready.push(n);
    }
    if (cancel.length) {
      await store.setStatus(cancel, 'cancelled', nowIso);
      report.cancelled += cancel.length;
    }

    const left = Math.max(
      0,
      notif.daily_cap - (await store.sentSince(u.user_id, localMidnightIso(local.date, tz))),
    );
    const now1 = ready.slice(0, left);
    const over = ready.slice(left);
    for (const n of now1) {
      const r = await send(u.user_id, {
        title: n.title,
        body: n.body ?? undefined,
        url: n.url ?? undefined,
        tag: n.id,
      });
      await store.setStatus([n.id], r === 'sent' ? 'sent' : 'failed', nowIso);
      if (r === 'sent') report.sent++;
    }
    if (over.length) {
      const last = await store.lastSummaryAt(u.user_id);
      if (last && now.getTime() - Date.parse(last) < SUMMARY_GAP_MS) {
        report.deferred += over.length; // wait for the next summary slot
      } else {
        const payload: PushPayload = {
          title: `${over.length} more reminder${over.length === 1 ? '' : 's'}`,
          body: over
            .map((n) => n.title)
            .slice(0, 6)
            .join(' · '),
          url: '/today',
          tag: 'summary',
        };
        const r = await send(u.user_id, payload);
        if (r === 'sent') {
          await store.setStatus(
            over.map((n) => n.id),
            'bundled',
            nowIso,
          );
          await store.logSent(u.user_id, {
            kind: 'summary',
            send_at: nowIso,
            title: payload.title,
            body: payload.body ?? '',
            url: '/today',
            dedupe_key: `summary:${nowIso}`,
          });
          report.bundled += over.length;
        }
      }
    }
  }
  return report;
}
