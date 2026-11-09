import { useState } from 'react';
import { Link } from 'react-router';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import { TextField } from '../../ui/TextField';

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
    <div
      aria-label="Meeting details"
      className="mb-4 grid grid-cols-1 gap-3 rounded-card border border-border/60 bg-surface p-4 sm:grid-cols-[12rem_1fr]"
    >
      <TextField
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setData({ meeting_date: e.target.value || null })}
      />
      <TextField
        label="Attendees"
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
      {eventId && (
        <Link to="/calendar" className="text-footnote text-accent hover:underline sm:col-span-2">
          From a calendar event
        </Link>
      )}
    </div>
  );
}
