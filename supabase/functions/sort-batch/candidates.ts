/**
 * Existing items a capture may move ("dentist moved to Thursday"): the person's
 * own open events and tasks near now. Sent to the model as data; it may only
 * point at one of these ids (Phase 10).
 */
export interface CandidateRow {
  id: string;
  type: string;
  title: string;
  start_at: string | null;
  due_at: string | null;
  rrule: string | null;
  series_id: string | null;
  status: string;
}

export interface Candidate {
  id: string;
  type: 'event' | 'task';
  title: string;
  when: string | null;
  repeats: boolean;
}

const DAY = 86_400_000;
export const CANDIDATE_LIMIT = 60;

/** Dated items from 7 days ago to 90 days ahead (nearest first), then overdue tasks; at most 60. */
export function pickCandidates(rows: CandidateRow[], now: Date): Candidate[] {
  const from = now.getTime() - 7 * DAY;
  const to = now.getTime() + 90 * DAY;
  const inWindow: { c: Candidate; d: number }[] = [];
  const overdue: { c: Candidate; d: number }[] = [];
  for (const r of rows) {
    if (r.status !== 'open' || (r.type !== 'event' && r.type !== 'task')) continue;
    const when = r.type === 'event' ? r.start_at : (r.due_at ?? r.start_at);
    if (!when) continue;
    const t = Date.parse(when);
    if (Number.isNaN(t)) continue;
    const c: Candidate = {
      id: r.id,
      type: r.type,
      title: r.title.slice(0, 120),
      when,
      repeats: !!(r.rrule || r.series_id),
    };
    if (t >= from && t <= to) inWindow.push({ c, d: Math.abs(t - now.getTime()) });
    else if (r.type === 'task' && t < from) overdue.push({ c, d: now.getTime() - t });
  }
  inWindow.sort((a, b) => a.d - b.d);
  overdue.sort((a, b) => a.d - b.d);
  return [...inWindow, ...overdue].slice(0, CANDIDATE_LIMIT).map((x) => x.c);
}
