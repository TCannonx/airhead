import * as chrono from 'chrono-node';
import Papa from 'papaparse';
import { byWhen, proposed, type ProposedEvent } from './types';

/**
 * CSV and Excel schedules (Task 4.10): parsed exactly, in code. A quick
 * column-mapping step covers unclear headers.
 */
export type Role = 'title' | 'date' | 'time' | 'end_time' | 'venue' | 'home' | 'away' | 'notes';
export type Mapping = Partial<Record<Role, number>>;

export const ROLE_LABELS: Record<Role, string> = {
  title: 'Title',
  date: 'Date',
  time: 'Start time',
  end_time: 'End time',
  venue: 'Venue',
  home: 'Home team',
  away: 'Away team',
  notes: 'Notes',
};

const GUESSES: [Role, RegExp][] = [
  ['date', /^(?:date|day|fixture date|match date|when)$/i],
  ['time', /^(?:time|start|start time|ko|k\/o|kick[- ]?off|throw[- ]?in|tip[- ]?off|from)$/i],
  ['end_time', /^(?:end|end time|finish|until|to)$/i],
  ['venue', /^(?:venue|location|ground|stadium|where|place|pitch)$/i],
  ['home', /^(?:home|home team)$/i],
  ['away', /^(?:away|away team|opponent|opponents|opposition|v|vs)$/i],
  ['title', /^(?:title|event|fixture|match|name|description|subject|competition)$/i],
  ['notes', /^(?:notes?|comments?|info|details)$/i],
];

/** Rows of cell text from CSV text. Empty rows are dropped. */
export function csvRows(text: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  return res.data.map((r) => r.map((c) => String(c ?? '').trim()));
}

/** Rows of cell text from the first sheet of an Excel file (dates as text). */
export async function excelRows(data: ArrayBuffer): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  return rows
    .map((r) => (r as unknown[]).map((c) => String(c ?? '').trim()))
    .filter((r) => r.some(Boolean));
}

/** Guesses which column plays which part from the header row. */
export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  header.forEach((h, i) => {
    const found = GUESSES.find(([role, re]) => m[role] === undefined && re.test(h.trim()));
    if (found) m[found[0]] = i;
  });
  return m;
}

/** A header row has no parseable date in the mapped date column. */
export function looksLikeHeader(row: string[]): boolean {
  return row.every((c) => !/\d/.test(c) || /^\D+$/.test(c)) || row.some((c) => /^date$/i.test(c));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date cell: ISO, Irish/UK day-first (3/4/2027 = 3 April), or words. */
export function parseDateCell(cell: string, now: Date): string | null {
  const s = cell.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (dmy) {
    const y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${y}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  }
  const r = chrono.en.GB.parseDate(s, now, { forwardDate: true });
  return r ? `${r.getFullYear()}-${pad(r.getMonth() + 1)}-${pad(r.getDate())}` : null;
}

/** A time cell: 19:30, 7.30pm, 7pm, 1930. Null for blank, "TBC" and the like. */
export function parseTimeCell(cell: string): string | null {
  const s = cell.trim().toLowerCase();
  if (!s || /tb[ca]|to be (?:confirmed|arranged)|\?/.test(s)) return null;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Turns rows into proposed events with a mapping; rows without a date are skipped. */
export function rowsToEvents(rows: string[][], mapping: Mapping, now: Date): ProposedEvent[] {
  const cell = (r: string[], role: Role) => {
    const i = mapping[role];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const out: ProposedEvent[] = [];
  for (const r of rows) {
    const date = parseDateCell(cell(r, 'date'), now);
    if (!date) continue;
    const home = cell(r, 'home');
    const away = cell(r, 'away');
    const title =
      cell(r, 'title') || (home && away ? `${home} v ${away}` : home || away) || 'Event';
    out.push(
      proposed({
        title,
        date,
        start_time: parseTimeCell(cell(r, 'time')),
        end_time: parseTimeCell(cell(r, 'end_time')),
        venue: cell(r, 'venue') || null,
        notes: cell(r, 'notes') || null,
      }),
    );
  }
  return out.sort(byWhen);
}
