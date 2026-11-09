import { useMemo } from 'react';
import { localDate, type CalEvent, type CalendarData } from '../../lib/calendar/sources';
import { hm, searchEvents, whenText, type SearchHit } from '../../lib/calendar/view';
import { EmptyState } from '../../ui/EmptyState';
import EventRow from './EventRow';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Hits({
  title,
  hits,
  timeZone,
  onOpen,
}: {
  title: string;
  hits: SearchHit[];
  timeZone: string;
  onOpen: (event: CalEvent) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <section aria-label={title} className="mb-4">
      <h3 className="mb-1.5 text-footnote font-semibold text-fg-muted">{title}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-card bg-surface">
        {hits.map(({ event }) => {
          const day = event.allDay ? event.start.slice(0, 10) : localDate(event.start, timeZone);
          return (
            <EventRow
              key={event.id}
              event={event}
              time={`${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`}
              endTime={event.allDay ? 'All day' : hm(event.start, timeZone)}
              subtitle={whenText(event, timeZone)}
              onOpen={onOpen}
            />
          );
        })}
      </ul>
    </section>
  );
}

/** Search results (Task 11.6): every calendar, past and future, as you type. */
export default function SearchResults({
  data,
  query,
  timeZone,
  onOpen,
}: {
  data: CalendarData;
  query: string;
  timeZone: string;
  onOpen: (event: CalEvent) => void;
}) {
  const { upcoming, past } = useMemo(
    () => searchEvents(data, query, new Date(), timeZone),
    [data, query, timeZone],
  );
  return (
    <div role="region" aria-label="Search results">
      {upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          icon="search"
          title="No events found"
          message={`Nothing on your calendars is called “${query.trim()}”.`}
        />
      ) : (
        <>
          <Hits title="Upcoming" hits={upcoming} timeZone={timeZone} onOpen={onOpen} />
          <Hits title="Past" hits={past} timeZone={timeZone} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}
