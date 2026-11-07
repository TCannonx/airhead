import { localMidnight } from '../calendar/sources';
import { addDays } from '../holidays/easter';
import type { AirheadDb } from '../db/db';
import { baseRecord, newItem, save } from '../db/repository';
import { queueSeriesFile } from '../files/upload';
import type { Item, Series } from '../schemas/records';
import type { ProposedEvent } from './types';

/** Local wall time on a date → UTC ISO instant (YYYY-MM-DD + HH:MM). */
export function localInstant(date: string, hhmm: string, tz: string): string {
  const midnight = Date.parse(localMidnight(date, tz));
  // Wall-clock minutes after midnight, corrected if the clocks change that day.
  const guess = new Date(
    midnight + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) * 60_000,
  );
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(guess);
  const got =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value);
  const want = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return new Date(guess.getTime() + (want - got) * 60_000).toISOString();
}

/** One proposed event as a calendar item in the series. */
export function eventItem(
  userId: string,
  e: ProposedEvent,
  series: Pick<Series, 'id' | 'calendar'>,
  tz: string,
): Item {
  const tbc = !e.start_time;
  const base = {
    type: 'event' as const,
    title: e.title.trim() || 'Event',
    body: e.notes,
    calendar: series.calendar,
    series_id: series.id,
    data: {
      ...(e.venue ? { location: e.venue } : {}),
      ...(tbc ? { time_tbc: true } : {}),
      source: 'import',
    },
  };
  if (tbc) {
    const last = e.end_date && e.end_date > e.date ? e.end_date : null;
    return newItem(userId, {
      ...base,
      all_day: true,
      start_at: localMidnight(e.date, tz),
      end_at: last ? localMidnight(last, tz) : null,
    });
  }
  const start = localInstant(e.date, e.start_time ?? '00:00', tz);
  let end = e.end_time ? localInstant(e.end_date ?? e.date, e.end_time, tz) : null;
  if (end && end <= start) end = localInstant(addDays(e.date, 1), e.end_time ?? '00:00', tz);
  return newItem(userId, {
    ...base,
    all_day: false,
    start_at: start,
    end_at: end ?? new Date(Date.parse(start) + 2 * 3_600_000).toISOString(),
  });
}

export interface SaveImportInput {
  name: string;
  calendar: 'personal' | 'us';
  colour?: string | null;
  events: ProposedEvent[];
  /** The original file, kept with the series (uploaded when online). */
  file?: { blob: Blob; name: string } | null;
  instruction?: string;
  route: string;
}

/** Saves the ticked events as a named series (one undoable unit: delete the series). */
export async function saveImport(
  db: AirheadDb,
  userId: string,
  input: SaveImportInput,
  tz: string,
): Promise<{ series: Series; items: Item[] }> {
  const id = crypto.randomUUID();
  let sourcePath: string | null = null;
  if (input.file) {
    const f = await queueSeriesFile(db, userId, id, input.file.blob, input.file.name);
    sourcePath = f.path;
  }
  const series = await save(db, 'series', {
    ...baseRecord(userId),
    id,
    name: input.name.trim() || 'Imported events',
    calendar: input.calendar,
    colour: input.colour ?? null,
    source_kind: 'import',
    source_path: sourcePath,
    data: { route: input.route, ...(input.instruction ? { instruction: input.instruction } : {}) },
  });
  const items: Item[] = [];
  for (const e of input.events.filter((x) => x.include)) {
    items.push(await save(db, 'items', eventItem(userId, e, series, tz)));
  }
  return { series, items };
}
