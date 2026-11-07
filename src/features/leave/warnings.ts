import type { Balance } from '../../lib/leave/engine';

export const daysText = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
export const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** Warnings worth a line: carried-over days at risk, days that would be lost. */
export function leaveWarnings(b: Balance): string[] {
  const out: string[] = [];
  if (b.carry_over_at_risk > 0 && b.carry_over_expires)
    out.push(
      `${daysText(b.carry_over_at_risk)} carried over must be used by ${longDate(b.carry_over_expires)}.`,
    );
  if (b.lose_at_year_end > 0)
    out.push(
      `${daysText(b.lose_at_year_end)} would be lost on ${longDate(b.year.end)} unless booked (only ${daysText(b.remaining - b.lose_at_year_end)} carry over).`,
    );
  return out;
}
