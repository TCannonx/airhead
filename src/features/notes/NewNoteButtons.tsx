import { useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { createNote } from '../../lib/db/notes';

const btn =
  'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700';

/** "New note" and "New meeting note" (Task 6.3), in the Library and on Capture. */
export default function NewNoteButtons() {
  const db = useDb();
  const { user, deviceId } = useAuth();
  const navigate = useNavigate();
  const make = (type: 'note' | 'meeting') =>
    void createNote(db, user?.id ?? '', deviceId ?? '', { type, kind: 'typed', title: '' }).then(
      ({ item }) => navigate(`/notes/${item.id}`),
    );
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => make('note')}>
        New note
      </button>
      <button type="button" className={btn} onClick={() => make('meeting')}>
        New meeting note
      </button>
    </div>
  );
}
