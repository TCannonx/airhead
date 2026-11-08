import { RRule } from 'rrule';

/** "every 2 weeks" from an RRULE; the raw rule if it can't be read. */
export function repeatText(rrule: string): string {
  try {
    return RRule.fromString(rrule.replace(/^RRULE:/, '')).toText();
  } catch {
    return rrule;
  }
}
