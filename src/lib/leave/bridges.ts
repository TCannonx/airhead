/**
 * Bridge-day finder (Task 8.7): 1–2 days of leave next to public holidays or
 * a weekend that give at least 4 days off in a row, ranked by days off per
 * leave day. Pure and import-free (copied verbatim to
 * supabase/functions/_shared/leave/bridges.ts; a Deno test checks they match).
 * Dates are YYYY-MM-DD; weekdays 0 = Sunday … 6 = Saturday.
 */
export interface BridgeInput {
  from: string;
  to: string;
  /** Working weekdays (0 = Sunday … 6 = Saturday). */
  workingDays: number[];
  /** Public holidays, closure days and other days off that need no leave. */
  daysOff: Set<string>;
  /** Days already booked as leave. */
  booked: Set<string>;
  /** Days with commitments that leave would clash with (events, the linked calendar). */
  busy: Set<string>;
  /** Leave days left to book. */
  balance: number;
  /** At most this many leave days per bridge (default 2). */
  maxLeave?: number;
  /** At least this many days off in a row (default 4). */
  minOff?: number;
}

export interface Bridge {
  /** The leave days to book. */
  leave: string[];
  /** The whole run of days off it gives. */
  start: string;
  end: string;
  daysOff: number;
  /** Days off per leave day. */
  ratio: number;
  /** Holidays inside the run (dates), so the wording can name them. */
  holidays: string[];
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function findBridges(input: BridgeInput, limit = 10): Bridge[] {
  const maxLeave = input.maxLeave ?? 2;
  const minOff = input.minOff ?? 4;
  const isWorking = (d: string) =>
    input.workingDays.includes(weekday(d)) && !input.daysOff.has(d) && !input.booked.has(d);

  const best = new Map<string, Bridge>();
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    if (!isWorking(d)) continue;
    // Leave on d, then (for two days) the next working day after it.
    const spans: string[][] = [[d]];
    if (maxLeave >= 2) {
      let next = addDays(d, 1);
      for (let i = 0; i < 7 && !isWorking(next); i++) next = addDays(next, 1);
      if (next <= input.to && isWorking(next)) spans.push([d, next]);
    }
    for (const leave of spans) {
      if (leave.length > input.balance) continue;
      if (leave.some((l) => input.busy.has(l))) continue;
      const taken = new Set(leave);
      const off = (x: string) => taken.has(x) || !isWorking(x);
      let start = leave[0] as string;
      let end = leave[leave.length - 1] as string;
      for (let i = 0; i < 20 && off(addDays(start, -1)); i++) start = addDays(start, -1);
      for (let i = 0; i < 20 && off(addDays(end, 1)); i++) end = addDays(end, 1);
      // Every day between the leave days must be off too.
      let length = 0;
      let gap = false;
      for (let x = start; x <= end; x = addDays(x, 1)) {
        length++;
        if (!off(x)) gap = true;
      }
      if (gap || length < minOff) continue;
      const holidays: string[] = [];
      for (let x = start; x <= end; x = addDays(x, 1)) if (input.daysOff.has(x)) holidays.push(x);
      const bridge: Bridge = {
        leave,
        start,
        end,
        daysOff: length,
        ratio: Math.round((length / leave.length) * 10) / 10,
        holidays,
      };
      const key = `${start}:${end}`;
      const known = best.get(key);
      if (!known || bridge.leave.length < known.leave.length) best.set(key, bridge);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.ratio - a.ratio || a.start.localeCompare(b.start))
    .slice(0, limit);
}
