import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import type { ImportRequest } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { addLinkedCalendar, LINKED_COLOURS } from '../../lib/db/feeds';
import { saveLeave } from '../../lib/db/leave';
import { softDelete } from '../../lib/db/repository';
import { compressImage } from '../../lib/files/image';
import { busyBetween, checkEvent } from '../../lib/import/checks';
import { applyInstruction } from '../../lib/import/filter';
import { isIcs, parseIcsImport } from '../../lib/import/ics';
import { saveImport } from '../../lib/import/save';
import {
  csvRows,
  excelRows,
  guessMapping,
  looksLikeHeader,
  ROLE_LABELS,
  rowsToEvents,
  type Mapping,
  type Role,
} from '../../lib/import/table';
import { byWhen, fromServer, type ProposedEvent } from '../../lib/import/types';
import { useSync } from '../../lib/sync/context';
import { todayKey } from '../leave/useWork';
import { deviceTimeZone, useCalendarData } from './useCalendarData';

type Source = 'file' | 'paste' | 'link';
type Step =
  | { kind: 'source' }
  | { kind: 'mapping'; rows: string[][]; mapping: Mapping; header: boolean }
  | { kind: 'review' }
  | { kind: 'done'; seriesId: string; itemIds: string[]; name: string };

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const cell =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-indigo-500 dark:hover:border-slate-700';
const primary =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50';
const secondary =
  'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700';

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });

const baseName = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

/** Calendar → Import (Task 4.10): file, paste or link plus an instruction, reviewed before saving. */
export default function ImportPage() {
  const db = useDb();
  const { user, services } = useAuth();
  const sync = useSync();
  const data = useCalendarData();
  const tz = deviceTimeZone();
  const userId = user?.id ?? '';

  const [source, setSource] = useState<Source>('file');
  const [instruction, setInstruction] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'source' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [events, setEvents] = useState<ProposedEvent[]>([]);
  const [route, setRoute] = useState('');
  const [name, setName] = useState('');
  const [calendar, setCalendar] = useState<'personal' | 'us'>('personal');
  const [leaveKeys, setLeaveKeys] = useState<Set<string>>(new Set());
  const [icsLink, setIcsLink] = useState<string | null>(null);
  const ai = services.imports;

  /** Code routes apply the instruction here; AI routes already did. */
  const review = (
    list: ProposedEvent[],
    via: string,
    suggested: string | null,
    filter: boolean,
  ) => {
    const { events: kept, applied } = filter
      ? applyInstruction(list, instruction)
      : { events: list, applied: null };
    setEvents(kept.sort(byWhen));
    setRoute(via);
    setName((n) => n || suggested || '');
    setNote(
      `${kept.length} event${kept.length === 1 ? '' : 's'} found` +
        (applied
          ? ` (${applied})`
          : filter && instruction.trim()
            ? ' (instruction not applied: edit the list below)'
            : '') +
        '.',
    );
    setStep({ kind: 'review' });
  };

  async function viaAI(
    req: Omit<ImportRequest, 'instruction' | 'today' | 'time_zone'>,
    via: string,
    suggested: string | null,
  ) {
    if (!ai) {
      setError(
        'Reading screenshots, PDFs and pasted text needs Airhead’s server. .ics, CSV and Excel files work offline.',
      );
      return;
    }
    const res = await ai.extract({ ...req, instruction, today: todayKey(), time_zone: tz });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (res.kind === 'ics') {
      setIcsLink(req.url ?? null);
      const parsed = parseIcsImport(res.text, new Date(), tz);
      review(parsed.events, 'link-ics', parsed.name ?? suggested, true);
      return;
    }
    review(
      res.events.map(fromServer).filter((e): e is ProposedEvent => e !== null),
      via,
      suggested,
      false,
    );
  }

  async function read() {
    setBusy(true);
    setError(null);
    setIcsLink(null);
    try {
      if (source === 'paste') {
        if (isIcs(text)) {
          const parsed = parseIcsImport(text, new Date(), tz);
          review(parsed.events, 'ics', parsed.name, true);
        } else await viaAI({ kind: 'text', text }, 'text', null);
      } else if (source === 'link') {
        await viaAI({ kind: 'link', url }, 'link', null);
      } else if (file) {
        const lower = file.name.toLowerCase();
        const suggested = baseName(file.name);
        if (lower.endsWith('.ics') || file.type === 'text/calendar') {
          const parsed = parseIcsImport(await file.text(), new Date(), tz);
          review(parsed.events, 'ics', parsed.name ?? suggested, true);
        } else if (lower.endsWith('.csv') || file.type === 'text/csv') {
          const rows = csvRows(await file.text());
          setName(suggested);
          startMapping(rows);
        } else if (/\.xlsx?$/.test(lower)) {
          const rows = await excelRows(await file.arrayBuffer());
          setName(suggested);
          startMapping(rows);
        } else if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
          const { pdfText, looksScanned } = await import('../../lib/import/pdf');
          const words = await pdfText(await file.arrayBuffer());
          if (looksScanned(words))
            await viaAI({ kind: 'pdf', data: await toBase64(file) }, 'pdf-scan', suggested);
          else await viaAI({ kind: 'text', text: words }, 'pdf-text', suggested);
        } else if (file.type.startsWith('image/')) {
          const small = await compressImage(file).catch(() => file);
          const type = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(small.type)
            ? small.type
            : 'image/jpeg';
          await viaAI(
            { kind: 'image', data: await toBase64(small), media_type: type },
            'image',
            suggested,
          );
        } else {
          setError('Use an .ics, CSV, Excel, PDF or image file.');
        }
      }
    } catch {
      setError('That couldn’t be read. Check the file and try again.');
    } finally {
      setBusy(false);
    }
  }

  function startMapping(rows: string[][]) {
    if (rows.length === 0) {
      setError('That file is empty.');
      return;
    }
    const header = looksLikeHeader(rows[0] ?? []);
    setStep({ kind: 'mapping', rows, header, mapping: header ? guessMapping(rows[0] ?? []) : {} });
  }

  const busyList = useMemo(() => {
    if (!data || events.length === 0) return [];
    const dates = events.map((e) => e.date).sort();
    return busyBetween(data, dates[0] ?? todayKey(), dates.at(-1) ?? todayKey(), tz);
  }, [data, events, tz]);

  async function save() {
    if (!data) return;
    setBusy(true);
    const { series, items } = await saveImport(
      db,
      userId,
      {
        name: name || 'Imported events',
        calendar,
        events,
        file: file && source === 'file' ? { blob: file, name: file.name } : null,
        instruction: instruction.trim() || undefined,
        route,
      },
      tz,
    );
    for (const e of events.filter((x) => x.include && leaveKeys.has(x.key))) {
      await saveLeave(
        db,
        userId,
        {
          start_date: e.date,
          end_date: e.date,
          start_half: false,
          end_half: false,
          leave_type: 'annual',
          status: 'planned',
          share_us: calendar === 'us',
          note: e.title,
        },
        data.work,
      );
    }
    setBusy(false);
    setStep({
      kind: 'done',
      seriesId: series.id,
      itemIds: items.map((i) => i.id),
      name: series.name,
    });
  }

  const setEvent = (key: string, patch: Partial<ProposedEvent>) =>
    setEvents((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  if (step.kind === 'done') {
    return (
      <Page title="Import schedule">
        <p role="status" className="mb-3">
          Saved {step.itemIds.length} event{step.itemIds.length === 1 ? '' : 's'} as “{step.name}”.
        </p>
        <div className="flex gap-2">
          <Link to="/calendar" className={primary}>
            Open calendar
          </Link>
          <button
            type="button"
            className={secondary}
            onClick={() =>
              void Promise.all([
                ...step.itemIds.map((id) => softDelete(db, 'items', id)),
                softDelete(db, 'series', step.seriesId),
              ]).then(() => setStep({ kind: 'source' }))
            }
          >
            Undo
          </button>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Import schedule" wide>
      {step.kind === 'source' && (
        <div className="max-w-2xl space-y-4">
          <p className="text-sm text-slate-500">
            Fixtures, a timetable or a programme: a file, a screenshot, pasted text or a link. .ics,
            CSV and Excel are read exactly on this device; anything else is read once by AI. Nothing
            is added until you review it.
          </p>
          <div role="tablist" aria-label="Import from" className="flex gap-1">
            {(['file', 'paste', 'link'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${source === s ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                {s === 'file' ? 'File or photo' : s === 'paste' ? 'Paste text' : 'Link'}
              </button>
            ))}
          </div>
          {source === 'file' && (
            <label className="block text-sm">
              File
              <input
                type="file"
                className={field}
                accept=".ics,.csv,.xlsx,.xls,.pdf,image/*,text/calendar,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
          {source === 'paste' && (
            <label className="block text-sm">
              Schedule text
              <textarea
                rows={8}
                className={field}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          {source === 'link' && (
            <label className="block text-sm">
              Link to a fixtures page or calendar
              <input
                type="url"
                className={field}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          )}
          <label className="block text-sm">
            Instruction (optional)
            <input
              className={field}
              placeholder="e.g. only home games, weekends only, attending all"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="button"
            className={primary}
            disabled={
              busy || (source === 'file' ? !file : source === 'paste' ? !text.trim() : !url.trim())
            }
            onClick={() => void read()}
          >
            {busy ? 'Reading…' : 'Read schedule'}
          </button>
          <p className="text-xs text-slate-500">
            Screenshots, PDFs, links and pasted text use one AI call (≈ €0.01 or less).
          </p>
        </div>
      )}

      {step.kind === 'mapping' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Which column is which? Airhead guessed from the headings.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={step.header}
              onChange={(e) => setStep({ ...step, header: e.target.checked })}
            />
            The first row is headings
          </label>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  {(step.rows[0] ?? []).map((_, i) => (
                    <th key={i} className="p-1 text-left">
                      <select
                        aria-label={`Column ${i + 1}`}
                        className={field}
                        value={
                          (Object.entries(step.mapping).find(([, c]) => c === i)?.[0] as
                            Role | undefined) ?? ''
                        }
                        onChange={(e) => {
                          const next: Mapping = Object.fromEntries(
                            Object.entries(step.mapping).filter(([, c]) => c !== i),
                          );
                          if (e.target.value) next[e.target.value as Role] = i;
                          setStep({ ...step, mapping: next });
                        }}
                      >
                        <option value="">(skip)</option>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {step.rows.slice(0, 6).map((r, ri) => (
                  <tr key={ri} className={ri === 0 && step.header ? 'font-semibold' : ''}>
                    {r.map((c, ci) => (
                      <td key={ci} className="border-t border-slate-100 p-1 dark:border-slate-800">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={step.mapping.date === undefined}
              onClick={() =>
                review(
                  rowsToEvents(
                    step.header ? step.rows.slice(1) : step.rows,
                    step.mapping,
                    new Date(),
                  ),
                  file?.name.toLowerCase().endsWith('.csv') ? 'csv' : 'excel',
                  null,
                  true,
                )
              }
            >
              Continue
            </button>
            <button type="button" className={secondary} onClick={() => setStep({ kind: 'source' })}>
              Back
            </button>
          </div>
        </div>
      )}

      {step.kind === 'review' && data && (
        <div className="space-y-3">
          {note && (
            <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
              {note}
            </p>
          )}
          {icsLink && (
            <p className="text-sm">
              This link is a calendar feed.{' '}
              <button
                type="button"
                className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                onClick={() =>
                  void addLinkedCalendar(db, userId, {
                    url: icsLink,
                    name: name || 'Linked calendar',
                    colour: LINKED_COLOURS[1] ?? '#7c3aed',
                  }).then(async (f) => {
                    await sync.syncNow();
                    await services.calendars?.refresh(f.id);
                    setNote('Added as a linked calendar: it will stay up to date by itself.');
                    setIcsLink(null);
                    setEvents([]);
                  })
                }
              >
                Add it as a linked calendar instead
              </button>{' '}
              so rescheduled fixtures update automatically.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Save as
              <input
                aria-label="Series name"
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Calendar
              <select
                className={field}
                value={calendar}
                onChange={(e) => setCalendar(e.target.value as 'personal' | 'us')}
              >
                <option value="personal">Personal</option>
                <option value="us">Us (shared)</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table aria-label="Proposed events" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="p-1">Add</th>
                  <th className="p-1">Date</th>
                  <th className="p-1">Time</th>
                  <th className="p-1">Title</th>
                  <th className="p-1">Venue</th>
                  <th className="p-1">Checks</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const c = checkEvent(e, busyList, data);
                  return (
                    <tr
                      key={e.key}
                      className="border-t border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="p-1">
                        <input
                          type="checkbox"
                          aria-label={`Add ${e.title}`}
                          checked={e.include}
                          onChange={(x) => setEvent(e.key, { include: x.target.checked })}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          type="date"
                          className={cell}
                          value={e.date}
                          onChange={(x) => setEvent(e.key, { date: x.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          type="time"
                          aria-label={`Time for ${e.title}`}
                          className={cell}
                          value={e.start_time ?? ''}
                          onChange={(x) => setEvent(e.key, { start_time: x.target.value || null })}
                        />
                        {!e.start_time && (
                          <span className="block text-xs text-amber-700 dark:text-amber-400">
                            time TBC
                          </span>
                        )}
                      </td>
                      <td className="p-1">
                        <input
                          className={cell}
                          value={e.title}
                          onChange={(x) => setEvent(e.key, { title: x.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          className={cell}
                          value={e.venue ?? ''}
                          onChange={(x) => setEvent(e.key, { venue: x.target.value || null })}
                        />
                      </td>
                      <td className="p-1 text-xs">
                        {c.clashes.length > 0 && (
                          <span className="block text-red-600">
                            Clashes with {c.clashes.join(', ')}
                          </span>
                        )}
                        {c.workingDay && (
                          <label className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={leaveKeys.has(e.key)}
                              onChange={(x) => {
                                const next = new Set(leaveKeys);
                                if (x.target.checked) next.add(e.key);
                                else next.delete(e.key);
                                setLeaveKeys(next);
                              }}
                            />
                            Working day: book leave
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Events without a confirmed time are saved as all-day “time TBC” events, with a reminder
            to check nearer the date.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy || !events.some((e) => e.include)}
              onClick={() => void save()}
            >
              Save {events.filter((e) => e.include).length} events
            </button>
            <button type="button" className={secondary} onClick={() => setStep({ kind: 'source' })}>
              Start again
            </button>
          </div>
        </div>
      )}
    </Page>
  );
}
