import type { Review } from '../schemas/records';

/**
 * Patterns (Task 8.6): habits over the last few weeks, computed on the device
 * from the weekly digests each review carries (`content.stats`, Task 8.1). No
 * AI and no server call, so it works offline.
 */
export interface Patterns {
  weeks: number;
  /** Monday first. */
  completionWeekdays: number[];
  captureHours: number[];
  completionHours: number[];
  /** Oldest week first. */
  perWeek: { week: string; done: number; due: number; carried: number; notifications: number }[];
  slippingTopics: { topic: string; count: number }[];
  returningIdeas: { title: string; returns: number }[];
}

const nums = (v: unknown, n: number) =>
  Array.from({ length: n }, (_, i) => (Array.isArray(v) ? Number(v[i]) || 0 : 0));
const num = (v: unknown) => Number(v) || 0;
const add = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] ?? 0));

export function patternsFrom(reviews: Review[], weeks = 8): Patterns {
  const recent = reviews
    .filter((r) => !r.deleted_at && r.content.stats && typeof r.content.stats === 'object')
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
    .slice(0, weeks)
    .reverse();
  const out: Patterns = {
    weeks: recent.length,
    completionWeekdays: Array(7).fill(0) as number[],
    captureHours: Array(24).fill(0) as number[],
    completionHours: Array(24).fill(0) as number[],
    perWeek: [],
    slippingTopics: [],
    returningIdeas: [],
  };
  const topics = new Map<string, number>();
  const ideas = new Map<string, number>();
  for (const r of recent) {
    const s = r.content.stats as Record<string, unknown>;
    out.completionWeekdays = add(out.completionWeekdays, nums(s.completion_weekdays, 7));
    out.captureHours = add(out.captureHours, nums(s.capture_hours, 24));
    out.completionHours = add(out.completionHours, nums(s.completion_hours, 24));
    const t = (s.tasks ?? {}) as Record<string, unknown>;
    const n = (s.notifications ?? {}) as Record<string, unknown>;
    out.perWeek.push({
      week: r.week_start,
      done: num(t.done),
      due: num(t.due),
      carried: num(t.carried),
      notifications: num(n.sent),
    });
    for (const x of Array.isArray(s.slipping_topics) ? s.slipping_topics : []) {
      const o = x as { topic?: unknown; count?: unknown };
      if (typeof o.topic === 'string')
        topics.set(o.topic, (topics.get(o.topic) ?? 0) + num(o.count));
    }
    for (const x of Array.isArray(s.returning_ideas) ? s.returning_ideas : []) {
      const o = x as { title?: unknown; returns?: unknown };
      if (typeof o.title === 'string')
        ideas.set(o.title, (ideas.get(o.title) ?? 0) + num(o.returns));
    }
  }
  out.slippingTopics = [...topics]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  out.returningIdeas = [...ideas]
    .map(([title, returns]) => ({ title, returns }))
    .sort((a, b) => b.returns - a.returns)
    .slice(0, 5);
  return out;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
