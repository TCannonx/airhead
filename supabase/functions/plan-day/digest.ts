import { addDays } from '../_shared/holidays/easter.ts';
import { readWork } from '../_shared/leave/work.ts';
import { readPlanSettings } from '../_shared/plan/defaults.ts';
import { localNow, readNotif } from '../scheduler-tick/notif.ts';
import { locationFor, occurrencesBetween } from '../scheduler-tick/tick.ts';
import { matchesPrepRule } from '../scheduler-tick/plan.ts';

/** What public.plan_digest returns (Task 13.5). */
export interface RawPlanDigest {
  date: string;
  time_zone: string;
  items: {
    id: string;
    type: 'event' | 'task';
    title: string;
    start_at: string | null;
    end_at: string | null;
    due_at: string | null;
    all_day: boolean;
    rrule: string | null;
    exdates: string[];
    location: string | null;
    travel_minutes: number | null;
    plan: {
      surface_at: string | null;
      effort_minutes: number | null;
      prep: string[];
      reason: string;
      source: string;
    } | null;
  }[];
  linked: {
    id: string;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: boolean;
  }[];
  nudges: { item_id: string; kind: string; send_at: string; source: string; dedupe_key: string }[];
  leave: { start: string; end: string; start_half: boolean; end_half: boolean }[];
  work_days: { date: string; location: string }[];
}

/** One occurrence in the planner's input: compact, one line each. */
export interface DigestItem {
  item_id: string;
  /** event and task can be planned; linked (another calendar) is context only. */
  kind: 'event' | 'task' | 'linked';
  occurrence_date: string;
  /** ISO instant of the start (event) or due time (task); null for all-day. */
  at: string | null;
  /** Local HH:MM of `at`, for the model. */
  time: string | null;
  end: string | null;
  all_day: boolean;
  title: string;
  location?: string;
  travel_minutes?: number;
  prep?: string[];
  prep_rule?: boolean;
  effort_minutes?: number;
  plan?: { reason: string; source: string };
  nudges?: { kind: string; at: string; source: string }[];
}

export interface PlanDigest {
  /** The evening's own local date; the plan is for the days after it. */
  date: string;
  time_zone: string;
  now: string;
  quiet_hours: { start: string; end: string };
  brief_time: string;
  prepare_evening_time: string;
  default_travel_minutes: number;
  days: { date: string; weekday: string; location: string }[];
  items: DigestItem[];
  prep_rules: { match: string[]; reminder: string }[];
}

export const DIGEST_CAP = 60;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Later in the week, an item makes the digest only when it needs lead time. */
function needsLeadTime(i: DigestItem): boolean {
  return (
    (i.prep?.length ?? 0) > 0 ||
    i.prep_rule === true ||
    i.travel_minutes !== undefined ||
    (i.effort_minutes ?? 0) > 60
  );
}

/**
 * Shapes the raw rows into the planner's input: tomorrow in full, plus items in
 * the following 6 days that need lead time; soonest first, capped at 60.
 * Returns how many were left out so the run can record it.
 */
export function buildPlanDigest(
  raw: RawPlanDigest,
  settings: Record<string, unknown>,
  now: Date,
): { digest: PlanDigest; left_out: number } {
  const tz = raw.time_zone;
  const tomorrow = addDays(raw.date, 1);
  const end = addDays(raw.date, 8);
  const plan = readPlanSettings(settings);
  const notif = readNotif(settings);
  const work = readWork(settings);
  const from = new Date(Date.parse(`${tomorrow}T00:00:00Z`) - 14 * 3_600_000);
  const to = new Date(Date.parse(`${end}T00:00:00Z`) + 14 * 3_600_000);
  const inWindow = (date: string) => date >= tomorrow && date < end;

  const nudgesFor = (id: string, date: string) => {
    const list = raw.nudges
      .filter((n) => n.item_id === id && localNow(new Date(n.send_at), tz).date <= date)
      .filter((n) => !n.dedupe_key.startsWith('plan:') || n.dedupe_key.endsWith(`:${date}`))
      .map((n) => {
        const l = localNow(new Date(n.send_at), tz);
        return { kind: n.kind, at: `${l.date} ${l.hhmm}`, source: n.source };
      });
    return list.length ? list : undefined;
  };

  const all: DigestItem[] = [];
  for (const r of raw.items) {
    const base = {
      item_id: r.id,
      kind: r.type,
      title: r.title,
      all_day: r.all_day,
      ...(r.location ? { location: r.location } : {}),
      ...(typeof r.travel_minutes === 'number' ? { travel_minutes: r.travel_minutes } : {}),
      ...(r.plan?.prep?.length ? { prep: r.plan.prep } : {}),
      ...(matchesPrepRule(r.title, settings) ? { prep_rule: true } : {}),
      ...(r.plan?.effort_minutes ? { effort_minutes: r.plan.effort_minutes } : {}),
      ...(r.plan ? { plan: { reason: r.plan.reason, source: r.plan.source } } : {}),
    };
    const starts: Date[] =
      r.type === 'event' && r.start_at
        ? r.rrule
          ? occurrencesBetween(
              {
                id: r.id,
                title: r.title,
                start_at: r.start_at,
                rrule: r.rrule,
                data: { exdates: r.exdates },
              },
              from,
              to,
              tz,
            )
          : [new Date(r.start_at)]
        : r.type === 'task'
          ? [new Date(r.due_at ?? r.plan?.surface_at ?? '')]
          : [];
    const dur = r.start_at && r.end_at ? Date.parse(r.end_at) - Date.parse(r.start_at) : null;
    for (const s of starts) {
      if (Number.isNaN(s.getTime())) continue;
      const l = localNow(s, tz);
      // An all-day event's date is its UTC date (stored at UTC midnight).
      const date = r.all_day && r.type === 'event' ? s.toISOString().slice(0, 10) : l.date;
      if (!inWindow(date)) continue;
      all.push({
        ...base,
        occurrence_date: date,
        at: r.all_day ? null : s.toISOString(),
        time: r.all_day ? null : l.hhmm,
        end: r.all_day || dur === null ? null : localNow(new Date(s.getTime() + dur), tz).hhmm,
        ...(nudgesFor(r.id, date) ? { nudges: nudgesFor(r.id, date) } : {}),
      });
    }
  }
  for (const e of raw.linked) {
    const s = new Date(e.start_at);
    const date = e.all_day ? e.start_at.slice(0, 10) : localNow(s, tz).date;
    if (!inWindow(date)) continue;
    all.push({
      item_id: e.id,
      kind: 'linked',
      title: e.title,
      all_day: e.all_day,
      occurrence_date: date,
      at: e.all_day ? null : s.toISOString(),
      time: e.all_day ? null : localNow(s, tz).hhmm,
      end: e.all_day || !e.end_at ? null : localNow(new Date(e.end_at), tz).hhmm,
    });
  }

  const chosen = all
    .filter((i) => i.occurrence_date === tomorrow || (i.kind !== 'linked' && needsLeadTime(i)))
    .sort(
      (a, b) =>
        a.occurrence_date.localeCompare(b.occurrence_date) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.title.localeCompare(b.title),
    );

  const leave = raw.leave.map((b) => ({ ...b, start_date: b.start, end_date: b.end }));
  const workDays = raw.work_days.map((w) => ({ date: w.date, location: w.location })) as Parameters<
    typeof locationFor
  >[3];
  const days = Array.from({ length: 7 }, (_, n) => {
    const date = addDays(raw.date, n + 1);
    return {
      date,
      weekday: WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? '',
      location: locationFor(
        date,
        work,
        leave as unknown as Parameters<typeof locationFor>[2],
        workDays,
      ),
    };
  });

  const rules = (
    Array.isArray((settings.work as { prep_rules?: unknown })?.prep_rules)
      ? ((settings.work as { prep_rules: unknown[] }).prep_rules as {
          match?: unknown;
          reminder?: unknown;
        }[])
      : []
  ).flatMap((r) =>
    Array.isArray(r.match)
      ? [
          {
            match: r.match.filter((w): w is string => typeof w === 'string'),
            reminder: String(r.reminder ?? ''),
          },
        ]
      : [],
  );

  return {
    digest: {
      date: raw.date,
      time_zone: tz,
      now: `${localNow(now, tz).date} ${localNow(now, tz).hhmm}`,
      quiet_hours: { start: notif.quiet_start, end: notif.quiet_end },
      brief_time: notif.brief_time,
      prepare_evening_time: plan.prepare_evening_time,
      default_travel_minutes: plan.default_travel_minutes,
      days,
      items: chosen.slice(0, DIGEST_CAP),
      prep_rules: rules,
    },
    left_out: Math.max(0, chosen.length - DIGEST_CAP),
  };
}
