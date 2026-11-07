/**
 * Scout findings from the person's own data (Task 8.10), all in code:
 * meetings with no follow-up, prep for events and birthdays in the next 10
 * days, overdue routines, ideas that have stalled, and weekend days free on
 * both calendars. Each finding can become a suggestion card.
 */
export interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
  start_at: string | null;
  due_at: string | null;
  rrule: string | null;
  created_at: string;
  updated_at: string;
}

export interface Finding {
  kind: 'follow_up' | 'prep' | 'routine' | 'stalled_idea' | 'free_time';
  title: string;
  body: string;
  proposed: Record<string, unknown> | null;
}

const DAY = 86_400_000;
const BIRTHDAY = /\b(?:birthday|b'?day|anniversary)\b/i;

/** Local YYYY-MM-DD of an instant in a time zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayName = (date: string) =>
  new Intl.DateTimeFormat('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(',', '');

export function findFindings(input: {
  now: Date;
  timeZone: string;
  items: ItemRow[];
  /** Item ids that have tasks made from them (note_id / idea_id) or Workshop drafts recently. */
  followedUp: Set<string>;
  /** Linked-calendar occurrences (start instants). */
  linkedStarts: string[];
}): Finding[] {
  const { now, timeZone } = input;
  const today = localDate(now, timeZone);
  const out: Finding[] = [];
  const open = input.items.filter((i) => i.status === 'open');

  // Meetings from the last two weeks with no summary and nothing made from them.
  for (const m of open.filter((i) => i.type === 'meeting')) {
    const date =
      typeof m.data.meeting_date === 'string' ? m.data.meeting_date : m.created_at.slice(0, 10);
    const age = (Date.parse(today) - Date.parse(date)) / DAY;
    if (age < 1 || age > 14) continue;
    if (m.data.summary || input.followedUp.has(m.id)) continue;
    out.push({
      kind: 'follow_up',
      title: `Follow up on ${m.title}`,
      body: `No summary or actions yet from ${m.title} (${date}).`,
      proposed: { type: 'task', title: `Write up actions from ${m.title}` },
    });
  }

  // Events and birthdays in the next 10 days.
  const soon = addDays(today, 10);
  for (const e of open.filter((i) => i.type === 'event' && i.start_at)) {
    const d = localDate(e.start_at as string, timeZone);
    if (d <= today || d > soon) continue;
    const birthday = BIRTHDAY.test(e.title);
    if (!birthday && e.data.prep !== true) continue;
    out.push({
      kind: 'prep',
      title: birthday ? `${e.title} is on ${weekdayName(d)}` : `Prep for ${e.title}`,
      body: birthday ? 'A card or a present?' : `${e.title} is on ${weekdayName(d)}.`,
      proposed: {
        type: 'task',
        title: birthday
          ? `Get something for ${e.title.replace(BIRTHDAY, '').trim() || 'the birthday'}`
          : `Prep for ${e.title}`,
        due_date: addDays(d, -1),
      },
    });
  }

  // Routines (recurring tasks) that are overdue.
  for (const t of open.filter((i) => i.type === 'task' && i.rrule && i.due_at)) {
    if (Date.parse(t.due_at as string) >= now.getTime() - DAY) continue;
    out.push({
      kind: 'routine',
      title: `${t.title} is overdue`,
      body: `Due ${localDate(t.due_at as string, timeZone)}.`,
      proposed: null,
    });
  }

  // Ideas with no activity for 30 days.
  for (const i of open.filter((x) => x.type === 'idea')) {
    if (now.getTime() - Date.parse(i.updated_at) < 30 * DAY) continue;
    if (input.followedUp.has(i.id)) continue;
    out.push({
      kind: 'stalled_idea',
      title: `Pick up “${i.title}”?`,
      body: 'Nothing has happened on this idea for a month. A small first step keeps it alive.',
      proposed: { type: 'task', title: `First step for ${i.title}` },
    });
  }

  // Weekend days in the next two weeks free on both calendars.
  const busy = new Set<string>();
  for (const e of open.filter((x) => x.type === 'event' && x.start_at))
    busy.add(localDate(e.start_at as string, timeZone));
  for (const s of input.linkedStarts) busy.add(localDate(s, timeZone));
  if (input.linkedStarts.length > 0) {
    for (let d = addDays(today, 1); d <= addDays(today, 14); d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if ((dow === 0 || dow === 6) && !busy.has(d)) {
        out.push({
          kind: 'free_time',
          title: `${weekdayName(d)} is free for you both`,
          body: 'Nothing on either calendar.',
          proposed: { type: 'event', title: 'Plans together', date: d, all_day: true },
        });
        if (out.filter((f) => f.kind === 'free_time').length >= 2) break;
      }
    }
  }
  return out;
}
