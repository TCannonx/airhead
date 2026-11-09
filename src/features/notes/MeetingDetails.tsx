import { useState } from 'react';
import { Link } from 'react-router';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';

const field = 'rounded-lg border border-border bg-surface px-2 py-1.5 text-footnote  ';

/** Date and attendees of a meeting note, and its event (Task 6.4). */
export default function MeetingDetails({ item }: { item: Item }) {
  const db = useDb();
  const attendees = Array.isArray(item.data.attendees) ? (item.data.attendees as string[]) : [];
  const [people, setPeople] = useState(attendees.join(', '));
  const date = typeof item.data.meeting_date === 'string' ? item.data.meeting_date : '';
  const eventId = typeof item.data.event_id === 'string' ? item.data.event_id : null;
  const setData = (patch: Record<string, unknown>) =>
    void update(db, 'items', item.id, { data: { ...item.data, ...patch } });

  return (
    <div aria-label="Meeting details" className="mb-4 flex flex-wrap items-end gap-3 text-footnote">
      <label>
        Date
        <input
          type="date"
          className={`${field} ml-2`}
          value={date}
          onChange={(e) => setData({ meeting_date: e.target.value || null })}
        />
      </label>
      <label className="min-w-0 flex-1">
        Attendees
        <input
          className={`${field} ml-2 w-full max-w-md`}
          placeholder="e.g. Aoife, Mark"
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          onBlur={() => {
            const list = people
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean);
            if (list.join('|') !== attendees.join('|')) setData({ attendees: list });
          }}
        />
      </label>
      {eventId && (
        <Link to="/calendar" className="text-accent hover:underline">
          From a calendar event
        </Link>
      )}
    </div>
  );
}
