import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/react/interaction';
import classicTheme from '@fullcalendar/react/themes/classic';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import './calendar.css';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useLayout } from '../../app/layout';
import {
  buildEvents,
  localDate,
  localMidnight,
  locationFor,
  movedTimes,
  type CalEvent,
} from '../../lib/calendar/sources';
import {
  CAL_VIEWS,
  calendarSources,
  periodRange,
  periodTitle,
  readHidden,
  readView,
  shiftPeriod,
  writeHidden,
  writeView,
  type CalView,
} from '../../lib/calendar/view';
import { useDb } from '../../lib/db/context';
import { softDelete, update } from '../../lib/db/repository';
import { defaultSlot } from '../../lib/calendar/quickAdd';
import { LOCATION_LABELS } from '../../lib/work/settings';
import type { LeaveFields } from '../../lib/db/leave';
import type { Item, LeaveBooking } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/TextField';
import { Toast } from '../../ui/Toast';
import LeaveSheet from '../leave/LeaveSheet';
import AgendaList from './AgendaList';
import CalendarsPanel from './CalendarsPanel';
import EventDetails from './EventDetails';
import EventEditor, { type EventDraft } from './EventEditor';
import MonthDots from './MonthDots';
import QuickAdd from './QuickAdd';
import RepeatChoice from './RepeatChoice';
import { editOccurrence } from '../../lib/db/recurring';
import SearchResults from './SearchResults';
import { deviceTimeZone, useCalendarData } from './useCalendarData';

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
      <h2 className="mb-1 text-footnote font-semibold text-fg-muted">Tasks to plan</h2>
      <p className="mb-2 text-caption text-fg-muted">
        Drag a task onto the calendar to block time.
      </p>
      {titles.length === 0 && <p className="text-footnote text-fg-muted">No open tasks.</p>}
      <ul ref={ref} aria-label="Tasks to plan" className="space-y-1">
        {titles.map((t) => (
          <li
            key={t.id}
            data-task-id={t.id}
            data-title={t.title}
            className="cursor-grab rounded-control border border-border bg-surface px-2 py-1.5 text-footnote hover:bg-fill"
          >
            {t.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The FullCalendar view for ours, or null where Airhead draws the view itself. */
function fcViewFor(view: CalView, wide: boolean): string | null {
  if (view === 'day') return 'timeGridDay';
  if (view === 'week') return 'timeGridWeek';
  if (view === 'month' && wide) return 'dayGridMonth';
  return null;
}

/**
 * The calendar (Tasks 4.2, 11.3, 11.6): Day, Week, Month and Agenda over every
 * source. Tapping an event opens its details; Edit is one tap further.
 */
export default function CalendarPage() {
  const db = useDb();
  const layout = useLayout();
  const wide = layout !== 'phone';
  const dark = usePrefersDark();
  const data = useCalendarData();
  const tz = deviceTimeZone();
  const today = localDate(new Date(), tz);
  const ref = useRef<CalendarRef>(null);
  const [view, setViewState] = useState<CalView>(() => readView(layout));
  const [anchor, setAnchor] = useState(today);
  const [hidden, setHidden] = useState(readHidden);
  const [query, setQuery] = useState('');
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [details, setDetails] = useState<CalEvent | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [leave, setLeave] = useState<{
    booking?: LeaveBooking;
    initial?: Partial<LeaveFields>;
  } | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [added, setAdded] = useState<Item | null>(null);
  const [moving, setMoving] = useState<{
    item: Item;
    occurrence: string;
    times: Pick<Item, 'start_at' | 'end_at' | 'all_day'>;
    revert: () => void;
  } | null>(null);
  // Week and day open at the hour before now, like Apple and Google.
  const [scrollTime] = useState(() => `${pad(Math.max(0, new Date().getHours() - 1))}:00:00`);

  const fcView = fcViewFor(view, wide);
  const setView = (v: CalView) => {
    setViewState(v);
    writeView(v);
  };
  // Back in this month, the selected day is today again (as in Apple Calendar).
  const go = (dir: 1 | -1) =>
    setAnchor((a) => {
      const next = shiftPeriod(view, a, dir);
      return view === 'month' && next.slice(0, 7) === today.slice(0, 7) ? today : next;
    });

  const open = (d: EventDraft) => {
    setDetails(null);
    setLeave(null);
    setDraft(d);
    setDraftKey((k) => k + 1);
  };
  const openLeave = (l: { booking?: LeaveBooking; initial?: Partial<LeaveFields> }) => {
    setDetails(null);
    setDraft(null);
    setLeave(l);
    setDraftKey((k) => k + 1);
  };
  const close = () => {
    setDraft(null);
    setLeave(null);
  };
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    writeHidden(next);
  };
  const showAll = () => {
    setHidden(new Set());
    writeHidden(new Set());
  };

  // FullCalendar follows our view and period.
  useEffect(() => {
    const api = ref.current?.getApi();
    if (!api || !fcView) return;
    if (api.view.type !== fcView) api.changeView(fcView, anchor);
    else api.gotoDate(anchor);
  }, [fcView, anchor]);

  // Day and week open at the current time, once the grid has its size.
  useEffect(() => {
    if (fcView !== 'timeGridDay' && fcView !== 'timeGridWeek') return;
    const frame = requestAnimationFrame(() => ref.current?.getApi().scrollToTime(scrollTime));
    return () => cancelAnimationFrame(frame);
  }, [fcView, scrollTime]);

  const range = periodRange(view, anchor);
  const events = useMemo(
    () =>
      data && fcView
        ? buildEvents(
            data,
            {
              start: new Date(localMidnight(range.from, tz)),
              end: new Date(localMidnight(range.to, tz)),
            },
            tz,
            hidden,
          )
        : [],
    [data, fcView, range.from, range.to, tz, hidden],
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
  const sources = calendarSources(data);
  const hiddenCount = sources.filter((s) => hidden.has(s.key)).length;

  const badge = (date: Date) => {
    if (!data) return null;
    const loc = locationFor(dayKey(date), data);
    return loc === 'off' ? null : (
      <span className="ah-loc mt-0.5 block w-fit rounded bg-fill px-1 text-[10px] font-medium text-fg-muted">
        {LOCATION_LABELS[loc]}
      </span>
    );
  };
  const api = () => ref.current?.getApi();

  // Swipe left or right on touch to change period (day, week, month).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current =
      e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t || view === 'agenda') return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && Date.now() - start.t < 700)
      go(dx < 0 ? 1 : -1);
  };

  const editItem = (item: Item, start: Date, occurrence?: string) =>
    open({ item, start, end: null, allDay: item.all_day, occurrence });

  const calendar = fcView && (
    <div data-color-scheme={dark ? 'dark' : 'light'} className="ah-calendar">
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, classicTheme]}
        initialView={fcView}
        initialDate={anchor}
        headerToolbar={false}
        height={wide ? 'calc(100dvh - 13rem)' : 'max(26rem, calc(100dvh - 19rem))'}
        firstDay={1}
        nowIndicator
        nowIndicatorLineClass="ah-now-line"
        scrollTime={scrollTime}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotHeaderFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        events={events}
        editable
        selectable
        selectMirror
        droppable
        selectLongPressDelay={300}
        eventLongPressDelay={300}
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
        dateClick={(info) => {
          // One tap or click on an empty slot (or a month day) creates an event there, an hour long.
          open(
            info.allDay
              ? { start: info.date, end: new Date(info.date.getTime() + 86_400_000), allDay: true }
              : {
                  start: info.date,
                  end: new Date(info.date.getTime() + 3_600_000),
                  allDay: false,
                },
          );
        }}
        select={(info) => {
          // A drag across slots or days is a span; a single slot is left to dateClick.
          const span = info.end.getTime() - info.start.getTime();
          if (span <= (info.allDay ? 86_400_000 : 30 * 60_000)) return;
          open({ start: info.start, end: info.end, allDay: info.allDay });
          api()?.unselect();
        }}
        eventClick={(info) => {
          const ev = events.find((e) => e.id === info.event.id);
          if (ev) setDetails(ev);
        }}
        eventChange={(info) => {
          const id = info.event.extendedProps.itemId as string | undefined;
          const item = id ? itemsById.get(id) : undefined;
          if (!item || !info.event.start) {
            info.revert();
            return;
          }
          const occurrence = info.oldEvent.extendedProps.occurrence as string | undefined;
          if (item.rrule && occurrence) {
            // One occurrence of a repeating event moved: ask which events move.
            setMoving({
              item,
              occurrence,
              times: movedTimes(info.event.start, info.event.end, info.event.allDay, tz),
              revert: info.revert,
            });
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

  const searching = query.trim().length > 0;
  const body = !data ? null : searching ? (
    <SearchResults data={data} query={query} timeZone={tz} onOpen={setDetails} />
  ) : view === 'agenda' ? (
    <AgendaList
      key={anchor}
      data={data}
      hidden={hidden}
      timeZone={tz}
      from={anchor}
      today={today}
      onOpen={setDetails}
    />
  ) : fcView ? (
    calendar
  ) : (
    <MonthDots
      data={data}
      hidden={hidden}
      timeZone={tz}
      selected={anchor}
      today={today}
      onSelect={setAnchor}
      onOpen={setDetails}
      onAdd={(day) => {
        const start = defaultSlot(day, new Date(), tz);
        open({ start, end: new Date(start.getTime() + 3_600_000), allDay: false });
      }}
    />
  );

  const newEvent = () => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    open({ start, end: new Date(start.getTime() + 3_600_000), allDay: false });
  };

  const panel = (
    <CalendarsPanel sources={sources} hidden={hidden} onToggle={toggle} onShowAll={showAll} />
  );

  return (
    <Page
      title="Calendar"
      wide
      actions={
        <>
          {!wide && (
            <IconButton icon="filter" label="Calendars" onClick={() => setCalendarsOpen(true)} />
          )}
          <IconButton icon="capture" label="New event" tone="accent" onClick={newEvent} />
        </>
      }
    >
      <div className={wide ? 'flex gap-6' : ''}>
        <div className="min-w-0 flex-1">
          <QuickAdd
            timeZone={tz}
            day={view === 'day' || view === 'month' ? anchor : today}
            onMore={open}
            onAdded={setAdded}
          />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="View"
              options={CAL_VIEWS}
              value={view}
              onChange={setView}
              className={wide ? '' : 'w-full'}
            />
            <TextField
              label="Search events"
              hideLabel
              type="search"
              placeholder="Search events"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={wide ? 'ml-auto w-64' : 'w-full'}
            />
          </div>
          {!searching && (
            <div className="mb-3 flex items-center gap-1">
              <h2 className="mr-auto text-headline" aria-live="polite">
                {periodTitle(view, anchor, today)}
              </h2>
              <Button size="sm" onClick={() => setAnchor(today)}>
                Today
              </Button>
              <IconButton icon="chevron-left" label="Previous" onClick={() => go(-1)} />
              <IconButton icon="chevron-right" label="Next" onClick={() => go(1)} />
            </div>
          )}
          {hiddenCount > 0 && (
            <p role="status" className="mb-3 flex items-center gap-2 text-footnote text-fg-muted">
              {hiddenCount === 1
                ? `${sources.find((s) => hidden.has(s.key))?.label} is hidden.`
                : `${hiddenCount} calendars are hidden.`}
              <Button variant="plain" size="sm" onClick={showAll}>
                Show all
              </Button>
            </p>
          )}
          <div data-testid="calendar-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {body}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openLeave({})}>
              Book leave
            </Button>
            <Link
              to="/calendar/import"
              className="inline-flex min-h-8 items-center rounded-control px-3 text-footnote font-semibold text-accent hover:bg-accent-soft"
            >
              Import
            </Link>
          </div>
        </div>
        {wide && (
          <aside aria-label="Calendar panel" className="w-64 shrink-0 space-y-6">
            <div>
              <h2 className="mb-1.5 text-footnote font-semibold text-fg-muted">Calendars</h2>
              {panel}
            </div>
            <TaskTray titles={unplanned} />
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={calendarsOpen} onClose={() => setCalendarsOpen(false)} title="Calendars">
          {panel}
        </Sheet>
      )}
      {details && data && (
        <EventDetails
          event={details}
          data={data}
          onClose={() => setDetails(null)}
          onEdit={editItem}
          onEditLeave={(booking) => openLeave({ booking })}
        />
      )}
      <Sheet
        open={!!draft}
        onClose={close}
        title={
          draft?.item
            ? draft.item.type === 'task'
              ? 'Edit time block'
              : 'Edit event'
            : 'New event'
        }
      >
        {draft && (
          <EventEditor
            key={draftKey}
            draft={draft}
            onClose={close}
            onBookLeave={(start_date, end_date) => openLeave({ initial: { start_date, end_date } })}
          />
        )}
      </Sheet>
      <Sheet
        open={!!moving}
        title="Move repeating event"
        onClose={() => {
          moving?.revert();
          setMoving(null);
        }}
      >
        {moving && (
          <RepeatChoice
            question="Move which events?"
            onCancel={() => {
              moving.revert();
              setMoving(null);
            }}
            onChoose={(scope) => {
              const { item, occurrence, times } = moving;
              setMoving(null);
              void editOccurrence(
                db,
                item,
                occurrence,
                scope,
                {
                  start_at: times.start_at ?? occurrence,
                  end_at: times.end_at,
                  all_day: times.all_day,
                },
                tz,
              );
            }}
          />
        )}
      </Sheet>
      {added && (
        <Toast
          message={`Added “${added.title}”`}
          action={{ label: 'Undo', onClick: () => void softDelete(db, 'items', added.id) }}
          onDismiss={() => setAdded(null)}
        />
      )}
      <Sheet
        open={!!leave && !!data}
        onClose={close}
        title={leave?.booking ? 'Edit leave' : 'Book leave'}
      >
        {leave && data && (
          <LeaveSheet
            key={draftKey}
            inSheet
            work={data.work}
            bookings={data.leave}
            booking={leave.booking}
            initial={leave.initial}
            onClose={close}
          />
        )}
      </Sheet>
    </Page>
  );
}
