import { Icon } from '../../app/Icon';
import type { CalEvent } from '../../lib/calendar/sources';
import { cx, FOCUS_RING } from '../../ui/cx';

/** One event in a list (Agenda, the phone's month day, search results); tap opens details. */
export default function EventRow({
  event,
  time,
  endTime,
  subtitle,
  onOpen,
}: {
  event: CalEvent;
  time: string;
  endTime?: string | null;
  subtitle?: string | null;
  onOpen: (event: CalEvent) => void;
}) {
  const repeats = !!event.extendedProps.occurrence;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        data-event-id={event.id}
        className={cx(
          'flex min-h-touch w-full items-stretch gap-3 px-4 py-2 text-left transition hover:bg-fill',
          FOCUS_RING,
        )}
      >
        <span className="flex w-14 shrink-0 flex-col pt-0.5 text-footnote tabular-nums">
          <span className={time === 'All day' ? 'text-fg-muted' : 'text-fg'}>{time}</span>
          {endTime && <span className="text-fg-muted">{endTime}</span>}
        </span>
        <span
          aria-hidden="true"
          data-testid="source-colour"
          className="w-1 shrink-0 rounded-full"
          style={{ background: event.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-body">{event.title}</span>
            {repeats && (
              <span title="Repeats" className="shrink-0 text-fg-subtle">
                <Icon name="repeat" className="size-4" />
                <span className="sr-only">, repeats</span>
              </span>
            )}
          </span>
          {subtitle && (
            <span className="block truncate text-footnote text-fg-muted">{subtitle}</span>
          )}
        </span>
      </button>
    </li>
  );
}
