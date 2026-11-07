import { weekday } from '../holidays/easter';
import type { ProposedEvent } from './types';

/**
 * The instruction as a filter for code-parsed imports (Task 4.10): all, home
 * only, away only, weekends only, weekdays only, or a named team. AI routes
 * get the instruction in the prompt instead.
 */
export interface FilterResult {
  events: ProposedEvent[];
  /** What was applied, in words, or null when the instruction meant "all". */
  applied: string | null;
}

const SPLIT = /\s+(?:v|vs\.?|versus)\s+/i;

/** The team in every "A v B" title: the one this schedule is for. */
export function ownTeam(events: ProposedEvent[]): string | null {
  const counts = new Map<string, number>();
  let matches = 0;
  for (const e of events) {
    const parts = e.title.split(SPLIT);
    if (parts.length !== 2) continue;
    matches++;
    for (const p of parts) {
      const t = p.trim().toLowerCase();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  if (matches < 2) return null;
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] === matches ? best[0] : null;
}

const isHome = (e: ProposedEvent, team: string) =>
  (e.title.split(SPLIT)[0] ?? '').trim().toLowerCase() === team ||
  /\bhome\b/i.test(`${e.venue ?? ''} ${e.notes ?? ''}`);

export function applyInstruction(events: ProposedEvent[], instruction: string): FilterResult {
  const ins = instruction.trim().toLowerCase();
  if (!ins || /^(?:all|attending all|everything|all of them)\b/.test(ins)) {
    return { events, applied: null };
  }
  let out = events;
  const applied: string[] = [];

  if (/\bweekends?\b/.test(ins)) {
    out = out.filter((e) => [0, 6].includes(weekday(e.date)));
    applied.push('weekends only');
  } else if (/\bweekdays?\b/.test(ins)) {
    out = out.filter((e) => ![0, 6].includes(weekday(e.date)));
    applied.push('weekdays only');
  }

  const homeOnly = /\bhome\b/.test(ins);
  const awayOnly = /\baway\b/.test(ins);
  if (homeOnly !== awayOnly) {
    const team = ownTeam(events);
    if (team) {
      out = out.filter((e) => isHome(e, team) === homeOnly);
      applied.push(
        `${homeOnly ? 'home' : 'away'} games of ${team.replace(/(^|\s)\S/g, (c) => c.toUpperCase())}`,
      );
    }
  }

  // "only Dublin" / "just the Ireland matches": keep titles naming it.
  const named =
    /\b(?:only|just)\s+(?:the\s+)?([a-z][\w' -]{2,30}?)(?:\s+(?:games?|matches|fixtures|events))?$/.exec(
      ins,
    );
  if (named?.[1] && !/^(?:home|away|weekends?|weekdays?)\b/.test(named[1])) {
    const name = named[1].trim();
    out = out.filter((e) => e.title.toLowerCase().includes(name));
    applied.push(`only “${name}”`);
  }

  return { events: out, applied: applied.length ? applied.join(', ') : null };
}
