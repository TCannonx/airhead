import { useMemo } from 'react';
import { addDays } from '../../lib/holidays/easter';
import {
  buildEvents,
  localMidnight,
  type CalEvent,
  type CalendarData,
} from '../../lib/calendar/sources';
import { agendaGroups, dayLabel, dayTitle, locationOf, periodRange } from '../../lib/calendar/view';
import { Button } from '../../ui/Button';
import { cx, FOCUS_RING } from '../../ui/cx';
import EventRow from './EventRow';

const HEAD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The phone's month (Task 11.3), Apple style: a grid of days with a dot per
 * calendar that has something on, and the selected day's events underneath.
 */
export default function MonthDots({
  data,
  hidden,
  timeZone,
  selected,
  today,
  onSelect,
  onOpen,
  onAdd,
}: {
  data: CalendarData;
  hidden: ReadonlySet<string>;
  timeZone: string;
  /** The selected day; its month is shown. */
  selected: string;
  today: string;
  onSelect: (day: string) => void;
  onOpen: (event: CalEvent) => void;
  /** Add an event on the selected day. */
  onAdd?: (day: string) => void;
}) {
  const { from, to } = periodRange('month', selected);
  const month = selected.slice(0, 7);
  const byDay = useMemo(() => {
    const events = buildEvents(
      data,
      {
        start: new Date(localMidnight(from, timeZone)),
        end: new Date(localMidnight(to, timeZone)),
      },
      timeZone,
      hidden,
    );
    return new Map(agendaGroups(events, from, to, timeZone).map((g) => [g.date, g.entries]));
  }, [data, hidden, timeZone, from, to]);

  // Only the weeks that hold days of this month.
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    if (week.some((d) => d.startsWith(month))) weeks.push(week);
  }
  const entries = byDay.get(selected) ?? [];

  return (
    <div>
      <div role="grid" aria-label="Month" className="rounded-card bg-surface p-1">
        <div role="row" className="grid grid-cols-7">
          {HEAD.map((h, i) => (
            <span
              key={i}
              role="columnheader"
              className="py-1 text-center text-caption font-medium text-fg-muted"
            >
              {h}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]} className="grid grid-cols-7">
            {week.map((d) => {
              const list = byDay.get(d) ?? [];
              const colours = [...new Set(list.map((e) => e.event.color))].slice(0, 3);
              const inMonth = d.startsWith(month);
              const isSel = d === selected;
              const isToday = d === today;
              return (
                <span role="gridcell" key={d} aria-selected={isSel}>
                  <button
                    type="button"
                    data-day={d}
                    aria-label={`${dayTitle(d)}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}` : ''}`}
                    aria-pressed={isSel}
                    onClick={() => onSelect(d)}
                    className={cx(
                      'flex min-h-touch w-full flex-col items-center justify-start rounded-control pt-1',
                      FOCUS_RING,
                    )}
                  >
                    <span
                      className={cx(
                        'inline-flex size-7 items-center justify-center rounded-full text-footnote tabular-nums',
                        isSel
                          ? isToday
                            ? 'bg-danger font-semibold text-white'
                            : 'bg-fg font-semibold text-canvas'
                          : isToday
                            ? 'font-semibold text-danger'
                            : inMonth
                              ? 'text-fg'
                              : 'text-fg-subtle',
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    <span aria-hidden="true" className="mt-0.5 flex h-1.5 gap-0.5">
                      {colours.map((c) => (
                        <span
                          key={c}
                          data-testid="day-dot"
                          className="size-1.5 rounded-full"
                          style={{ background: c }}
                        />
                      ))}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <section aria-label={`Events on ${dayTitle(selected)}`} className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-footnote font-semibold text-fg-muted">{dayLabel(selected, today)}</h3>
          {onAdd && (
            <Button size="sm" variant="plain" onClick={() => onAdd(selected)}>
              Add event
            </Button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="rounded-card bg-surface px-4 py-3 text-footnote text-fg-muted">
            No events.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card bg-surface">
            {entries.map((e) => (
              <EventRow
                key={e.event.id}
                event={e.event}
                time={e.time}
                endTime={e.endTime}
                subtitle={locationOf(e.event, data)}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
