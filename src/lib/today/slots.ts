/**
 * Free time slots for the Top 3 (Task 5.3). Works in local wall-clock minutes
 * from midnight ("09:30" = 570), so a clock-change day needs no special case.
 *
 * This file has no imports on purpose: the same text is copied to
 * supabase/functions/_shared/today/slots.ts, and a Deno test checks the two
 * copies are identical.
 */
export interface Span {
  /** Minutes from local midnight. */
  start: number;
  end: number;
}

export interface SlotTask {
  id: string;
  minutes: number;
}

export const DEFAULT_WINDOW = {
  working: { start: 480, end: 1260 },
  off: { start: 540, end: 1260 },
};
/** A short breather between a meeting and a task. */
export const BUFFER = 5;
export const MIN_TASK = 15;
export const MAX_TASK = 120;

export function toMinutes(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`not a time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Rounds up to the next quarter hour, so slots start at :00, :15, :30 or :45. */
const quarter = (m: number) => Math.ceil(m / 15) * 15;

/**
 * Free gaps inside a window, around busy spans (merged, buffered). Gaps
 * shorter than `minGap` minutes are left out. `from` (e.g. now) trims the start.
 */
export function freeGaps(busy: Span[], window: Span, from = 0, minGap = MIN_TASK): Span[] {
  const start = Math.max(window.start, quarter(from));
  const spans = busy
    .map((b) => ({ start: b.start - BUFFER, end: b.end + BUFFER }))
    .filter((b) => b.end > start && b.start < window.end)
    .sort((a, b) => a.start - b.start);
  const gaps: Span[] = [];
  let cursor = start;
  for (const b of spans) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps
    .map((g) => ({ start: quarter(g.start), end: g.end }))
    .filter((g) => g.end - g.start >= minGap);
}

/**
 * Puts each task, in order, into the earliest gap it fits (its estimate is
 * clamped to 15–120 minutes). A task that fits nowhere gets null.
 */
export function fitTasks(tasks: SlotTask[], gaps: Span[]): Map<string, Span | null> {
  const free = gaps.map((g) => ({ ...g }));
  const out = new Map<string, Span | null>();
  for (const t of tasks) {
    const need = Math.max(MIN_TASK, Math.min(MAX_TASK, Math.round(t.minutes)));
    const gap = free.find((g) => g.end - g.start >= need);
    if (!gap) {
      out.set(t.id, null);
      continue;
    }
    const slot = { start: gap.start, end: gap.start + need };
    out.set(t.id, slot);
    gap.start = quarter(slot.end + BUFFER);
  }
  return out;
}

/** "12:30–12:45" */
export const slotText = (s: Span) => `${toHHMM(s.start)}–${toHHMM(s.end)}`;
