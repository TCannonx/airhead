/**
 * Import schedule (Task 4.10): every route (.ics, CSV/Excel, text, image,
 * PDF, link) ends in the same list of proposed events for review.
 */
export interface ProposedEvent {
  /** Temporary id for the review table. */
  key: string;
  include: boolean;
  title: string;
  /** YYYY-MM-DD (local). */
  date: string;
  /** HH:MM (local), or null when the time isn't confirmed ("time TBC"). */
  start_time: string | null;
  end_time: string | null;
  /** A last day for multi-day events (inclusive), else null. */
  end_date: string | null;
  venue: string | null;
  notes: string | null;
}

let n = 0;
export const proposalKey = () => `p${Date.now().toString(36)}${(++n).toString(36)}`;

export function proposed(
  fields: Partial<ProposedEvent> & Pick<ProposedEvent, 'title' | 'date'>,
): ProposedEvent {
  return {
    key: proposalKey(),
    include: true,
    start_time: null,
    end_time: null,
    end_date: null,
    venue: null,
    notes: null,
    ...fields,
  };
}

/** Sorted by date then time, untimed first on a day. */
export const byWhen = (a: ProposedEvent, b: ProposedEvent) =>
  a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? '');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Server answers are checked again on the device: bad times become "TBC", bad dates drop the event. */
export function fromServer(e: {
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  end_date: string | null;
  venue: string | null;
  notes: string | null;
}): ProposedEvent | null {
  if (!DATE.test(e.date) || Number.isNaN(Date.parse(`${e.date}T00:00:00Z`))) return null;
  const start = e.start_time && TIME.test(e.start_time) ? e.start_time : null;
  return proposed({
    ...e,
    title: e.title.trim() || 'Event',
    start_time: start,
    end_time: start && e.end_time && TIME.test(e.end_time) ? e.end_time : null,
    end_date: e.end_date && DATE.test(e.end_date) && e.end_date > e.date ? e.end_date : null,
  });
}
