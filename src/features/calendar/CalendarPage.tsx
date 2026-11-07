import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import classicTheme from '@fullcalendar/react/themes/classic';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import './calendar.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../../app/Page';
import { useLayout } from '../../app/layout';
import {
  buildEvents,
  locationFor,
  movedTimes,
  SOURCE_COLOURS,
  SOURCE_LABELS,
  type Range,
} from '../../lib/calendar/sources';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import { LOCATION_LABELS } from '../../lib/work/settings';
import EventEditor, { type EventDraft } from './EventEditor';
import { deviceTimeZone, useCalendarData } from './useCalendarData';

const VIEWS: [string, string][] = [
  ['timeGridDay', 'Day'],
  ['timeGridWeek', 'Week'],
  ['dayGridMonth', 'Month'],
  ['agenda', 'Agenda'],
];
const HIDDEN_KEY = 'airhead.calendar.hidden';
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800';

function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-DD of a calendar Date in device time. */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function usePrefersDark() {
  const [dark, setDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

/** Open tasks with no time yet, to drag onto the calendar (tablet and desktop). */
function TaskTray({ titles }: { titles: { id: string; title: string }[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const d = new Draggable(ref.current, {
      itemSelector: '[data-task-id]',
      eventData: (el) => ({
        title: el.dataset.title ?? '',
        duration: '00:30',
        create: false,
      }),
    });
    return () => d.destroy();
  }, []);
  return (
    <div>
      <h2 className="mb-1 font-semibold">Tasks to plan</h2>
      <p className="mb-2 text-xs text-slate-500">Drag a task onto the calendar to block time.</p>
      {titles.length === 0 && <p className="text-sm text-slate-500">No open tasks.</p>}
      <ul ref={ref} aria-label="Tasks to plan" className="space-y-1">
        {titles.map((t) => (
          <li
            key={t.id}
            data-task-id={t.id}
            data-title={t.title}
            className="cursor-grab rounded-lg border border-slate-200 px-2 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
          >
            {t.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The calendar (Task 4.2): day, week, month and agenda views over every source. */
export default function CalendarPage() {
  const db = useDb();
  const layout = useLayout();
  const dark = usePrefersDark();
  const data = useCalendarData();
  const tz = deviceTimeZone();
  const ref = useRef<CalendarRef>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [title, setTitle] = useState('');
  const [view, setView] = useState(layout === 'phone' ? 'agenda' : 'timeGridWeek');
  const [hidden, setHidden] = useState(readHidden);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);

  const open = (d: EventDraft) => {
    setDraft(d);
    setDraftKey((k) => k + 1);
  };
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: toggles just aren't remembered */
    }
  };

  const events = useMemo(
    () => (data && range ? buildEvents(data, range, tz, hidden) : []),
    [data, range, tz, hidden],
  );
  const itemsById = useMemo(() => new Map(data?.items.map((i) => [i.id, i])), [data]);
  const unplanned = useMemo(
    () =>
      (data?.items ?? [])
        .filter((i) => i.type === 'task' && i.status === 'open' && !i.start_at)
        .slice(0, 50)
        .map((i) => ({ id: i.id, title: i.title })),
    [data],
  );
  const sources: [string, string, string][] = [
    ...(['personal', 'us', 'tasks', 'holidays', 'leave'] as const).map(
      (k) => [k, SOURCE_LABELS[k], SOURCE_COLOURS[k]] as [string, string, string],
    ),
    ...(data?.feeds ?? [])
      .filter((f) => f.kind === 'linked_in')
      .map(
        (f) =>
          [`feed:${f.id}`, f.name || 'Linked calendar', f.colour ?? SOURCE_COLOURS.linked] as [
            string,
            string,
            string,
          ],
      ),
  ];
  const badge = (date: Date) => {
    if (!data) return null;
    const loc = locationFor(dayKey(date), data);
    return loc === 'off' ? null : (
      <span className="ah-loc mt-0.5 block w-fit rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {LOCATION_LABELS[loc]}
      </span>
    );
  };
  const api = () => ref.current?.getApi();
  const wide = layout !== 'phone';

  const calendar = (
    <div data-color-scheme={dark ? 'dark' : 'light'} className="ah-calendar min-h-[32rem]">
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicTheme]}
        initialView={view}
        views={{ agenda: { type: 'list', duration: { days: 14 } } }}
        headerToolbar={false}
        height={layout === 'phone' ? 'auto' : 'calc(100dvh - 13rem)'}
        firstDay={1}
        nowIndicator
        scrollTime="07:00"
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotHeaderFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        events={events}
        editable
        selectable
        selectMirror
        droppable
        selectLongPressDelay={300}
        eventLongPressDelay={300}
        datesSet={(info) => {
          setRange({ start: info.start, end: info.end });
          setTitle(info.view.title);
          setView(info.view.type);
        }}
        dayHeaderContent={(arg) => (
          <span>
            {arg.text}
            {arg.view.type !== 'dayGridMonth' && badge(arg.date)}
          </span>
        )}
        dayCellTopContent={(arg) => (
          <span>
            {arg.dayNumberText}
            {arg.view.type === 'dayGridMonth' &&
              badge(
                new Date(arg.date.getUTCFullYear(), arg.date.getUTCMonth(), arg.date.getUTCDate()),
              )}
          </span>
        )}
        eventContent={(arg) => (
          <span className="block truncate text-xs leading-tight">
            <span className="font-semibold">{arg.event.title}</span>
            {arg.timeText && <span className="ml-1 opacity-80">{arg.timeText}</span>}
          </span>
        )}
        select={(info) => {
          // A single tapped slot becomes an hour, like most calendars.
          const short = !info.allDay && info.end.getTime() - info.start.getTime() <= 30 * 60_000;
          open({
            start: info.start,
            end: short ? new Date(info.start.getTime() + 3_600_000) : info.end,
            allDay: info.allDay,
          });
          api()?.unselect();
        }}
        eventClick={(info) => {
          const id = info.event.extendedProps.itemId as string | undefined;
          const item = id ? itemsById.get(id) : undefined;
          if (item)
            open({ item, start: info.event.start ?? new Date(), end: null, allDay: item.all_day });
        }}
        eventChange={(info) => {
          const id = info.event.extendedProps.itemId as string | undefined;
          const item = id ? itemsById.get(id) : undefined;
          if (!item || item.rrule || !info.event.start) {
            info.revert();
            return;
          }
          void update(
            db,
            'items',
            item.id,
            movedTimes(info.event.start, info.event.end, info.event.allDay, tz),
          );
        }}
        drop={(info) => {
          const id = info.draggedEl.dataset.taskId;
          if (!id) return;
          void update(db, 'items', id, movedTimes(info.date, null, info.allDay, tz, 30));
        }}
      />
    </div>
  );

  return (
    <Page title="Calendar" wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <button type="button" className={btn} aria-label="Previous" onClick={() => api()?.prev()}>
            ‹
          </button>
          <button type="button" className={btn} onClick={() => api()?.today()}>
            Today
          </button>
          <button type="button" className={btn} aria-label="Next" onClick={() => api()?.next()}>
            ›
          </button>
        </div>
        <h2 className="mr-auto text-lg font-semibold" aria-live="polite">
          {title}
        </h2>
        <div
          role="group"
          aria-label="View"
          className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
        >
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => api()?.changeView(v)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                view === v
                  ? 'bg-white shadow-sm dark:bg-slate-950'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          onClick={() => {
            const start = new Date();
            start.setMinutes(0, 0, 0);
            start.setHours(start.getHours() + 1);
            open({ start, end: new Date(start.getTime() + 3_600_000), allDay: false });
          }}
        >
          New event
        </button>
      </div>

      <div role="group" aria-label="Calendars" className="mb-3 flex flex-wrap gap-2">
        {sources.map(([key, label, colour]) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-800"
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={!hidden.has(key)}
              onChange={() => toggle(key)}
            />
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{
                background: hidden.has(key) ? 'transparent' : colour,
                border: `2px solid ${colour}`,
              }}
            />
            {label}
          </label>
        ))}
      </div>

      {wide ? (
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">{calendar}</div>
          <aside aria-label="Calendar panel" className="w-64 shrink-0">
            {draft ? (
              <EventEditor key={draftKey} draft={draft} onClose={() => setDraft(null)} />
            ) : (
              <TaskTray titles={unplanned} />
            )}
          </aside>
        </div>
      ) : (
        <>
          {calendar}
          {draft && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Event"
              className="fixed inset-0 z-40 flex items-end bg-black/30"
              onClick={(e) => e.target === e.currentTarget && setDraft(null)}
            >
              <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-slate-950">
                <EventEditor key={draftKey} draft={draft} onClose={() => setDraft(null)} />
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
