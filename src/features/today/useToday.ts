import { useLiveQuery } from 'dexie-react-hooks';
import { buildEvents, localDate, localMidnight, type CalEvent } from '../../lib/calendar/sources';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import type { Brief, Item } from '../../lib/schemas/records';
import { fallbackList, type ListTask } from '../../lib/today/fallback';
import {
  DEFAULT_WINDOW,
  fitTasks,
  freeGaps,
  toHHMM,
  toMinutes,
  type Span,
} from '../../lib/today/slots';
import { deviceTimeZone, useCalendarData } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';

export interface TopTask {
  item: Item;
  why: string | null;
  slot: { start: string; end: string } | null;
  minutes: number;
}

export interface TodayView {
  date: string;
  /** Today's brief, or null (then the list below is the device's own fallback). */
  brief: Brief | null;
  events: CalEvent[];
  top3: TopTask[];
  also: Item[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const localHHMM = (iso: string, tz: string) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  return `${p.find((x) => x.type === 'hour')?.value ?? '00'}:${p.find((x) => x.type === 'minute')?.value ?? '00'}`;
};

/** A task as the shared ranking code sees it (local due date and time). */
export function asListTask(i: Item, today: string, tz: string): ListTask {
  return {
    id: i.id,
    title: i.title,
    due: i.due_at ? `${localDate(i.due_at, tz)} ${localHHMM(i.due_at, tz)}` : null,
    top3: i.top3_date === today,
    carry_count: i.carry_count,
    age_days: Math.max(
      0,
      Math.round((Date.parse(today) - Date.parse(localDate(i.created_at, tz))) / 86_400_000),
    ),
  };
}

/** Today's events, Top 3 and Also today, from the brief when there is one (Task 5.7). */
export function useToday(): TodayView | undefined {
  const db = useDb();
  const data = useCalendarData();
  const tz = deviceTimeZone();
  const today = todayKey();
  const brief = useLiveQuery(
    async () =>
      (await db.briefs.where('local_date').equals(today).toArray()).find((b) => !b.deleted_at) ??
      null,
    [db, today],
  );
  const { user } = useAuth();
  const todaySettings = useLiveQuery(
    async () =>
      ((await db.settings.get(user?.id ?? ''))?.data.today ?? {}) as Record<string, unknown>,
    [db, user?.id],
  );
  if (!data || brief === undefined || todaySettings === undefined) return undefined;

  const range = {
    start: new Date(localMidnight(today, tz)),
    end: new Date(Date.parse(localMidnight(today, tz)) + 86_400_000),
  };
  const events = buildEvents(data, range, tz, new Set(['tasks'])).sort((a, b) =>
    a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1,
  );
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const tasks = data.items.filter((i) => i.type === 'task' && !i.deleted_at);

  if (brief) {
    const top3 = brief.content.top3
      .map((t) => {
        const item = byId.get(t.item_id);
        return item && item.status !== 'dropped'
          ? { item, why: t.why, slot: t.slot, minutes: t.minutes }
          : null;
      })
      .filter((x): x is TopTask => x !== null);
    // Tasks added to today's Top 3 by hand after the brief arrived.
    for (const t of tasks) {
      if (t.top3_date === today && t.status !== 'dropped' && !top3.some((x) => x.item.id === t.id))
        top3.push({ item: t, why: null, slot: null, minutes: 30 });
    }
    const also = brief.content.also_today
      .map((id) => byId.get(id))
      .filter((i): i is Item => !!i && i.status === 'open' && i.top3_date !== today);
    return { date: today, brief, events, top3, also };
  }

  // No brief yet (or offline): the device's own list, with slots from today's calendar.
  const open = tasks.filter((t) => t.status === 'open');
  const list = fallbackList(
    open.map((t) => asListTask(t, today, tz)),
    today,
  );
  const busy: Span[] = events
    .filter((e) => !e.allDay)
    .map((e) => ({
      start: toMinutes(localHHMM(e.start, tz)),
      end: e.end ? toMinutes(localHHMM(e.end, tz)) : toMinutes(localHHMM(e.start, tz)) + 60,
    }));
  const now = new Date();
  const fromMinutes = now.getHours() * 60 + now.getMinutes();
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ws = todaySettings.window_start;
  const we = todaySettings.window_end;
  const window =
    typeof ws === 'string' && typeof we === 'string' && hhmm.test(ws) && hhmm.test(we) && we > ws
      ? { start: toMinutes(ws), end: toMinutes(we) }
      : DEFAULT_WINDOW.working;
  const slots = fitTasks(
    list.top3.map((id) => ({ id, minutes: 30 })),
    freeGaps(busy, window, fromMinutes),
  );
  const top3 = list.top3
    .map((id) => byId.get(id))
    .filter((i): i is Item => !!i)
    .map((item) => {
      const s = slots.get(item.id);
      return {
        item,
        why: null,
        slot: s ? { start: toHHMM(s.start), end: toHHMM(s.end) } : null,
        minutes: 30,
      };
    });
  // Done today stays visible with its tick.
  for (const t of tasks) {
    if (t.top3_date === today && t.status === 'done' && !top3.some((x) => x.item.id === t.id))
      top3.push({ item: t, why: null, slot: null, minutes: 30 });
  }
  const also = list.also_today.map((id) => byId.get(id)).filter((i): i is Item => !!i);
  return { date: today, brief: null, events, top3, also };
}

/** "08:00–08:15" as a time block on today's date (local), for "Block". */
export function slotTimes(date: string, slot: { start: string; end: string }) {
  const [sy, sm, sd] = date.split('-').map(Number) as [number, number, number];
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return new Date(sy, sm - 1, sd, h, m).toISOString();
  };
  return { start_at: at(slot.start), end_at: at(slot.end), all_day: false };
}

export const hhmmOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
