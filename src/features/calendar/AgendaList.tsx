import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildEvents,
  localMidnight,
  type CalEvent,
  type CalendarData,
} from '../../lib/calendar/sources';
import { agendaGroups, dayLabel, locationOf, periodRange } from '../../lib/calendar/view';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import EventRow from './EventRow';

/** How many 30-day pages the Agenda loads at most (about a year). */
const MAX_PAGES = 12;

/**
 * The Agenda (Task 11.6): the next 30 days grouped by day under sticky day
 * headers, loading 30 more as the end scrolls into view.
 */
export default function AgendaList({
  data,
  hidden,
  timeZone,
  from,
  today,
  onOpen,
}: {
  data: CalendarData;
  hidden: ReadonlySet<string>;
  timeZone: string;
  from: string;
  today: string;
  onOpen: (event: CalEvent) => void;
}) {
  const [pages, setPages] = useState(1);
  const range = periodRange('agenda', from, pages);
  const groups = useMemo(() => {
    const events = buildEvents(
      data,
      {
        start: new Date(localMidnight(range.from, timeZone)),
        end: new Date(localMidnight(range.to, timeZone)),
      },
      timeZone,
      hidden,
    );
    return agendaGroups(events, range.from, range.to, timeZone);
  }, [data, hidden, timeZone, range.from, range.to]);

  const sentinel = useRef<HTMLDivElement>(null);
  const more = pages < MAX_PAGES;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setPages((p) => Math.min(MAX_PAGES, p + 1));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, pages]);

  return (
    <div aria-label="Agenda" role="region">
      {groups.length === 0 && (
        <EmptyState
          icon="calendar"
          title={pages === 1 ? 'Nothing in the next 30 days' : 'Nothing coming up'}
          message="Events, time blocks, leave and holidays show here."
        />
      )}
      {groups.map((g) => (
        <section key={g.date} aria-label={dayLabel(g.date, today)} className="mb-3">
          <h3
            data-date={g.date}
            className="sticky top-0 z-10 bg-canvas/95 py-1.5 text-footnote font-semibold text-fg-muted backdrop-blur"
          >
            {dayLabel(g.date, today)}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-card bg-surface">
            {g.entries.map((e) => (
              <EventRow
                key={`${e.event.id}@${g.date}`}
                event={e.event}
                time={e.time}
                endTime={e.endTime}
                subtitle={locationOf(e.event, data)}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <div ref={sentinel} className="flex justify-center py-4">
          <Button size="sm" onClick={() => setPages((p) => Math.min(MAX_PAGES, p + 1))}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
