import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { notesForEvent, startNotesFor } from '../../lib/db/notes';

/** "Start notes" / "Open notes" for an event (Task 6.4). */
export default function StartNotesButton({
  eventKey,
  title,
  date,
  className = 'rounded-md px-2 py-0.5 text-caption font-semibold text-accent hover:bg-accent-soft  ',
}: {
  eventKey: string;
  title: string;
  date: string;
  className?: string;
}) {
  const db = useDb();
  const { user, deviceId } = useAuth();
  const navigate = useNavigate();
  const existing = useLiveQuery(() => notesForEvent(db, eventKey), [db, eventKey], null);
  if (existing === null) return null;
  return (
    <button
      type="button"
      aria-label={`${existing ? 'Open notes' : 'Start notes'}: ${title}`}
      className={className}
      onClick={() =>
        void startNotesFor(db, user?.id ?? '', deviceId ?? '', { key: eventKey, title, date }).then(
          (note) => navigate(`/notes/${note.id}`),
        )
      }
    >
      {existing ? 'Open notes' : 'Start notes'}
    </button>
  );
}
