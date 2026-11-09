import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CalEvent } from '../../lib/calendar/sources';
import type { CalendarData } from '../../lib/calendar/sources';
import { eventDays, repeatWords, sourceOf, whenText } from '../../lib/calendar/view';
import { useDb } from '../../lib/db/context';
import { softDelete } from '../../lib/db/repository';
import { inWorkshop, sendToWorkshop } from '../../lib/db/workshop';
import type { Item, LeaveBooking } from '../../lib/schemas/records';
import { beforeText, leaveTypeOf, prepRulesFor } from '../../lib/work/settings';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import StartNotesButton from '../notes/StartNotesButton';
import { reminderLabel } from './eventOptions';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <dt className="text-caption font-medium text-fg-muted">{label}</dt>
      <dd className="text-body break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

/**
 * The read view of an event (Task 11.3): what, when, repeat, calendar,
 * reminders, location and notes. Edit is one tap further. Linked-calendar
 * events and public holidays are read-only; leave opens its own editor.
 */
export default function EventDetails({
  event,
  data,
  onClose,
  onEdit,
  onEditLeave,
}: {
  event: CalEvent;
  data: CalendarData;
  onClose: () => void;
  onEdit: (item: Item, start: Date) => void;
  onEditLeave: (booking: LeaveBooking) => void;
}) {
  const db = useDb();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [confirming, setConfirming] = useState(false);
  const { itemId, externalId, leaveId, source } = event.extendedProps;
  const item = itemId ? data.items.find((i) => i.id === itemId) : undefined;
  const external = externalId ? data.external.find((e) => e.id === externalId) : undefined;
  const booking = leaveId ? data.leave.find((b) => b.id === leaveId) : undefined;
  const cal = sourceOf(event, data);
  const isTask = item?.type === 'task';
  const readOnly = !item && !booking;

  const location =
    (item && typeof item.data.location === 'string' && item.data.location) ||
    external?.location ||
    null;
  const notes = item?.body || external?.description || booking?.note || null;
  const prep = item && !isTask && !item.rrule ? prepRulesFor(item.title, data.work.prep_rules) : [];

  const footer = item ? (
    confirming ? (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-footnote">
          {item.rrule ? 'Delete this event and all its repeats?' : 'Delete this event?'}
        </p>
        <Button onClick={() => setConfirming(false)}>Cancel</Button>
        <Button
          variant="destructive"
          onClick={() => void softDelete(db, 'items', item.id).then(onClose)}
        >
          {item.rrule ? 'Delete all' : 'Delete'}
        </Button>
      </div>
    ) : (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {inWorkshop(item) ? (
          <Link
            to={`/workshop/${item.id}`}
            className="mr-auto inline-flex min-h-11 items-center px-1 font-semibold text-accent"
          >
            In the Workshop
          </Link>
        ) : (
          <Button variant="plain" className="mr-auto" onClick={() => void sendToWorkshop(db, item)}>
            Send to Workshop
          </Button>
        )}
        {!isTask && (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => onEdit(item, new Date(item.start_at ?? event.start))}
        >
          Edit
        </Button>
      </div>
    )
  ) : booking ? (
    <Button variant="primary" onClick={() => onEditLeave(booking)}>
      Edit leave
    </Button>
  ) : undefined;

  return (
    <Sheet open title={event.title} onClose={onClose} footer={footer}>
      <dl aria-label="Event details">
        <Row label="When">{whenText(event, tz)}</Row>
        {item?.rrule && <Row label="Repeats">{repeatWords(item.rrule)}</Row>}
        <Row label="Calendar">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              data-testid="calendar-colour"
              className="size-3 rounded-full"
              style={{ background: cal.colour }}
            />
            {cal.label}
          </span>
        </Row>
        {booking && (
          <Row label="Leave">
            {leaveTypeOf(data.work, booking.leave_type).name} · {booking.status}
          </Row>
        )}
        {item && !isTask && !item.all_day && (
          <Row label="Reminder">{reminderLabel(item.data.reminder_minutes)}</Row>
        )}
        {prep.length > 0 && (
          <Row label="Before this">
            {prep.map((r) => `${r.reminder} (${beforeText(r.minutes_before)})`).join('\n')}
          </Row>
        )}
        {location && <Row label="Location">{location}</Row>}
        {notes && <Row label="Notes">{notes}</Row>}
      </dl>
      {item && !isTask && (
        <StartNotesButton
          eventKey={item.id}
          title={item.title}
          date={eventDays(event, tz).first}
          className="mt-2 inline-flex min-h-11 items-center rounded-control px-1 font-semibold text-accent hover:bg-accent-soft"
        />
      )}
      {readOnly && (
        <p className="mt-3 text-footnote text-fg-muted">
          {source === 'holidays'
            ? 'A public holiday. Read only.'
            : `From the linked calendar “${cal.label}”. Read only: change it where it comes from.`}
        </p>
      )}
    </Sheet>
  );
}
