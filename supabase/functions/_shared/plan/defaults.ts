/**
 * Default nudge timings in code, no AI (Task 13.1, spec 2026-11-16-ai-brain §2 rule 1).
 * Every event or task gets these the moment it is saved; the planner may improve on them.
 * Pure and import-free so it can be copied to the device if it is ever needed there.
 */
export type DefaultKind = 'prepare' | 'leave' | 'do';

export interface PlanItem {
  type: string;
  title: string;
  all_day: boolean;
  /** Minutes to get there, when the item says (items.data.travel_minutes). */
  travel_minutes?: number | null;
  /** Prep text from the item's plan or details. */
  prep?: string[] | null;
  /** True when one of the owner's keyword prep rules matches the title. */
  has_prep_rule?: boolean;
}

export interface PlanSettings {
  /** The evening-before time for a prepare nudge (default 20:30). */
  prepare_evening_time: string;
  default_travel_minutes: number;
  /** When the evening planner runs (default 18:00). */
  evening_time: string;
  /** The AI planner is on; defaults apply either way. */
  enabled: boolean;
  /** Daily planning spend cap in euros (default 0.15). */
  daily_cap_eur: number;
}

export interface DefaultNudge {
  kind: DefaultKind;
  /** ISO instant. */
  at: string;
  title: string;
  reason: string;
}

export const DEFAULT_PLAN: PlanSettings = {
  prepare_evening_time: '20:30',
  default_travel_minutes: 30,
  evening_time: '18:00',
  enabled: true,
  daily_cap_eur: 0.15,
};

/** No prepare nudge inside this many minutes of the start. */
export const PREPARE_MIN_LEAD = 45;
const LEAVE_MARGIN = 10;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function readPlanSettings(data: Record<string, unknown> | null | undefined): PlanSettings {
  const p = (data?.plan ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PLAN };
  for (const k of ['prepare_evening_time', 'evening_time'] as const) {
    if (typeof p[k] === 'string' && HHMM.test(p[k] as string)) out[k] = p[k] as string;
  }
  const t = p.default_travel_minutes;
  if (Number.isInteger(t) && (t as number) >= 0 && (t as number) <= 600)
    out.default_travel_minutes = t as number;
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  const c = p.daily_cap_eur;
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 10) out.daily_cap_eur = c;
  return out;
}

function local(at: Date, tz: string): { date: string; hhmm: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** A local wall time on a date as an instant, correct on clock-change days. */
export function localInstant(date: string, hhmm: string, tz: string): Date {
  const want = minutesOf(hhmm);
  let guess = Date.parse(`${date}T${hhmm}:00Z`);
  for (let i = 0; i < 3; i++) {
    const got = local(new Date(guess), tz);
    const dayShift = got.date === date ? 0 : got.date < date ? -1440 : 1440;
    const diff = want - (minutesOf(got.hhmm) + dayShift);
    if (diff === 0) break;
    guess += diff * 60_000;
  }
  return new Date(guess);
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Default nudges for one occurrence of an event, or a task's due time.
 * `occurrenceStart` is the event start or task due instant (local midnight for all-day).
 */
export function defaultNudges(
  item: PlanItem,
  occurrenceStart: Date,
  settings: PlanSettings,
  tz: string,
  now: Date = new Date(),
): DefaultNudge[] {
  const out: DefaultNudge[] = [];
  const start = occurrenceStart.getTime();
  const { date, hhmm } = local(occurrenceStart, tz);
  const eveningBefore = () => localInstant(previousDate(date), settings.prepare_evening_time, tz);

  if (item.type === 'task') {
    if (!item.all_day) {
      out.push({
        kind: 'do',
        at: occurrenceStart.toISOString(),
        title: item.title,
        reason: 'Due now',
      });
    }
  } else if (item.type === 'event') {
    if (item.all_day) {
      if ((item.prep?.length ?? 0) > 0 || item.has_prep_rule) {
        out.push({
          kind: 'prepare',
          at: eveningBefore().toISOString(),
          title: `Get ready: ${item.title}`,
          reason: 'All-day tomorrow with things to prepare',
        });
      }
    } else {
      let prepare: Date | null;
      let reason: string;
      if (minutesOf(hhmm) < 12 * 60) {
        prepare = eveningBefore();
        reason = `Starts at ${hhmm}, so get ready the evening before`;
      } else {
        const floor = localInstant(date, '08:00', tz).getTime();
        prepare = new Date(Math.max(start - 3 * 3_600_000, floor));
        reason = `Starts at ${hhmm}, so get ready that morning`;
      }
      if (prepare.getTime() > start - PREPARE_MIN_LEAD * 60_000) prepare = null;
      if (prepare) {
        out.push({
          kind: 'prepare',
          at: prepare.toISOString(),
          title: `Get ready: ${item.title}`,
          reason,
        });
      }
      const travel =
        typeof item.travel_minutes === 'number' && item.travel_minutes >= 0
          ? item.travel_minutes
          : settings.default_travel_minutes;
      out.push({
        kind: 'leave',
        at: new Date(start - (travel + LEAVE_MARGIN) * 60_000).toISOString(),
        title: `Time to leave: ${item.title}`,
        reason: `${travel} min to get there plus ${LEAVE_MARGIN} spare`,
      });
    }
  }
  return out.filter((n) => Date.parse(n.at) > now.getTime());
}
