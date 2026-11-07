import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { addDays, weekday } from '../_shared/holidays/easter.ts';
import { holidaysBetween } from '../_shared/holidays/ie.ts';
import { patternLocation, readWork, type WorkLocation } from '../_shared/leave/work.ts';
import { BRIEF_SYSTEM, buildBriefMessage } from '../_shared/prompts/brief.v1.ts';
import { fallbackList, type ListTask } from '../_shared/today/fallback.ts';
import {
  DEFAULT_WINDOW,
  fitTasks,
  freeGaps,
  toHHMM,
  toMinutes,
  type Span,
} from '../_shared/today/slots.ts';
import { localMidnightIso, localNow, localTimeIso } from '../scheduler-tick/notif.ts';
import { occurrencesBetween } from '../scheduler-tick/tick.ts';

/** The digest from morning_digest() (Task 5.2). */
export interface Digest {
  date: string;
  weekday: string;
  time_zone: string;
  events: {
    id: string;
    title: string;
    date: string;
    start: string | null;
    end: string | null;
    all_day: boolean;
    calendar: string;
    location: string | null;
    time_tbc: boolean;
  }[];
  recurring: {
    id: string;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: boolean;
    rrule: string;
    calendar: string;
  }[];
  linked: {
    title: string;
    date: string;
    start: string | null;
    end: string | null;
    calendar: string;
  }[];
  tasks: {
    id: string;
    title: string;
    due: string | null;
    top3: boolean;
    carry_count: number;
    age_days: number;
  }[];
  yesterday: { done: number; unfinished_top3: number; captured: number };
  leave: {
    start: string;
    end: string;
    type: string;
    status: string;
    start_half: boolean;
    end_half: boolean;
  }[];
  work_days: { date: string; location: WorkLocation }[];
  ideas: { id: string; title: string }[];
}

export const BriefResult = z.object({
  reflection: z.string().nullable(),
  top3: z.array(z.object({ item_id: z.string(), why: z.string(), minutes: z.number() })),
  also_today: z.array(z.string()),
  prep_nudges: z.array(
    z.object({ text: z.string(), send_at: z.string(), item_id: z.string().nullable() }),
  ),
});
export type BriefResultT = z.infer<typeof BriefResult>;

export interface BriefContent {
  reflection: string | null;
  top3: {
    item_id: string;
    title: string;
    why: string | null;
    minutes: number;
    slot: { start: string; end: string } | null;
  }[];
  also_today: string[];
  prep: { text: string; send_at: string; item_id: string | null }[];
}

export interface BuiltBrief {
  status: 'ok' | 'fallback';
  content: BriefContent;
  model: string | null;
  cost_eur: number;
  /** Why the fallback was used (for the log), or null. */
  reason: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LABELS: Record<WorkLocation, string> = {
  wfh: 'WFH',
  office: 'Office',
  client: 'Client site',
  travel: 'Travel',
  off: 'Off',
};

/** Adds what SQL can't compute: holidays, today's location, recurring occurrences. */
export function enrichDigest(d: Digest, settings: Record<string, unknown>) {
  const work = readWork(settings);
  const end = addDays(d.date, 7);
  const holidays = holidaysBetween(d.date, end, work.manual_holidays).map((h) => ({
    date: h.date,
    name: h.name,
    kind: h.kind,
  }));
  const onLeave = d.leave.some(
    (b) => b.start <= d.date && b.end >= d.date && !b.start_half && !b.end_half,
  );
  const override = d.work_days.find((w) => w.date === d.date)?.location;
  const isHoliday = holidays.some((h) => h.date === d.date && h.kind !== 'common');
  const location: WorkLocation = onLeave
    ? 'off'
    : (override ??
      (isHoliday || work.closure_days.includes(d.date)
        ? 'off'
        : patternLocation(work, weekday(d.date))));
  const from = new Date(localMidnightIso(d.date, d.time_zone));
  const to = new Date(localMidnightIso(addDays(d.date, 8), d.time_zone));
  const recurring = d.recurring.flatMap((r) =>
    occurrencesBetween(
      { id: r.id, title: r.title, start_at: r.start_at, rrule: r.rrule, data: {} },
      new Date(from.getTime() - 1),
      to,
      d.time_zone,
    ).map((o) => {
      const l = localNow(o, d.time_zone);
      const dur = r.end_at ? Date.parse(r.end_at) - Date.parse(r.start_at) : null;
      return {
        id: r.id,
        title: r.title,
        date: l.date,
        start: r.all_day ? null : l.hhmm,
        end:
          r.all_day || dur === null
            ? null
            : localNow(new Date(o.getTime() + dur), d.time_zone).hhmm,
        all_day: r.all_day,
        calendar: r.calendar,
      };
    }),
  );
  return {
    ...d,
    holidays,
    location_today: LABELS[location],
    recurring: undefined,
    recurring_events: recurring,
  };
}

/** Today's busy spans in local minutes (timed events from every source). */
export function busyToday(e: ReturnType<typeof enrichDigest>): Span[] {
  const spans: Span[] = [];
  const add = (start: string | null, end: string | null, date: string) => {
    if (date !== e.date || !start || !HHMM.test(start)) return;
    const s = toMinutes(start);
    const en = end && HHMM.test(end) ? toMinutes(end) : s + 60;
    spans.push({ start: s, end: en > s ? en : s + 60 });
  };
  for (const x of e.events) add(x.start, x.end, x.date);
  for (const x of e.recurring_events) add(x.start, x.end, x.date);
  for (const x of e.linked) add(x.start, x.end, x.date);
  return spans;
}

/** The day window for slots: settings.data.today.window, else working-day or day-off defaults. */
export function dayWindow(settings: Record<string, unknown>, date: string, location: string): Span {
  const today = (settings.today ?? {}) as { window_start?: string; window_end?: string };
  const def = location === 'Off' ? DEFAULT_WINDOW.off : DEFAULT_WINDOW.working;
  const start =
    typeof today.window_start === 'string' && HHMM.test(today.window_start)
      ? toMinutes(today.window_start)
      : def.start;
  const end =
    typeof today.window_end === 'string' && HHMM.test(today.window_end)
      ? toMinutes(today.window_end)
      : def.end;
  return end > start ? { start, end } : def;
}

/** Keeps only what the digest allows: known ids, sane minutes and times. */
export function validate(r: BriefResultT, d: Digest, nowHHMM: string): BriefResultT {
  const taskIds = new Set(d.tasks.map((t) => t.id));
  const anyIds = new Set([
    ...taskIds,
    ...d.events.map((e) => e.id),
    ...d.recurring.map((e) => e.id),
  ]);
  const seen = new Set<string>();
  const top3 = r.top3
    .filter((t) => taskIds.has(t.item_id) && !seen.has(t.item_id) && seen.add(t.item_id))
    .slice(0, 3)
    .map((t) => ({
      item_id: t.item_id,
      why: t.why.trim().slice(0, 80),
      minutes: Math.max(15, Math.min(120, Math.round(t.minutes) || 30)),
    }));
  const also_today = [...new Set(r.also_today)]
    .filter((id) => taskIds.has(id) && !seen.has(id))
    .slice(0, 8);
  const prep_nudges = r.prep_nudges
    .filter((p) => HHMM.test(p.send_at) && p.send_at > nowHHMM && p.text.trim())
    .map((p) => ({
      text: p.text.trim().slice(0, 140),
      send_at: p.send_at,
      item_id: p.item_id && anyIds.has(p.item_id) ? p.item_id : null,
    }))
    .slice(0, 3);
  const reflection = r.reflection?.trim() ? r.reflection.trim().slice(0, 500) : null;
  return { reflection, top3, also_today, prep_nudges };
}

export interface BriefDeps {
  ai: AIClient;
  store: UsageStore;
  /** Memory profile text (cached second system block), or ''. */
  profile: string;
}

/**
 * One morning brief: one large-tier call over the enriched digest, validated,
 * with slots from code. Any AI failure (cap, refusal, outage, bad output) gives
 * the code-built list instead.
 */
export async function buildBrief(
  userId: string,
  digest: Digest,
  settings: Record<string, unknown>,
  now: Date,
  deps: BriefDeps,
): Promise<BuiltBrief> {
  const enriched = enrichDigest(digest, settings);
  const nowLocal = localNow(now, digest.time_zone);
  const titles = new Map(digest.tasks.map((t) => [t.id, t.title]));

  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'morning_brief',
      tier: 'large',
      system: [BRIEF_SYSTEM, deps.profile],
      messages: [
        { role: 'user', content: buildBriefMessage(enriched, `${digest.date} ${nowLocal.hhmm}`) },
      ],
      schema: BriefResult,
      maxTokens: 4000,
      effort: 'low',
      background: true,
    },
  );

  let status: 'ok' | 'fallback' = 'ok';
  let reason: string | null = null;
  let picked: BriefResultT;
  let cost = 0;
  if (result.ok) {
    picked = validate(result.data, digest, nowLocal.hhmm);
    cost = result.costEur;
  } else {
    status = 'fallback';
    reason = result.error_code;
    const list = fallbackList(digest.tasks as ListTask[], digest.date);
    picked = {
      reflection: null,
      top3: list.top3.map((id) => ({ item_id: id, why: '', minutes: 30 })),
      also_today: list.also_today,
      prep_nudges: [],
    };
  }

  const window = dayWindow(settings, digest.date, enriched.location_today);
  const gaps = freeGaps(busyToday(enriched), window, toMinutes(nowLocal.hhmm));
  const slots = fitTasks(
    picked.top3.map((t) => ({ id: t.item_id, minutes: t.minutes })),
    gaps,
  );

  return {
    status,
    reason,
    model: status === 'ok' ? 'claude-sonnet-5-5' : null,
    cost_eur: cost,
    content: {
      reflection: picked.reflection,
      top3: picked.top3.map((t) => {
        const s = slots.get(t.item_id);
        return {
          item_id: t.item_id,
          title: titles.get(t.item_id) ?? '',
          why: t.why || null,
          minutes: t.minutes,
          slot: s ? { start: toHHMM(s.start), end: toHHMM(s.end) } : null,
        };
      }),
      also_today: picked.also_today,
      prep: picked.prep_nudges.map((p) => ({
        text: p.text,
        send_at: localTimeIso(digest.date, p.send_at, digest.time_zone),
        item_id: p.item_id,
      })),
    },
  };
}
