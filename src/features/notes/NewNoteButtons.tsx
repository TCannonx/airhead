import { useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { createNote } from '../../lib/db/notes';
import { Button } from '../../ui/Button';

/** "New note" and "New meeting note" (Task 6.3), in the Library and on Capture. */
export default function NewNoteButtons({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const db = useDb();
  const { user, deviceId } = useAuth();
  const navigate = useNavigate();
  const make = (type: 'note' | 'meeting', kind: 'typed' | 'ink' = 'typed') =>
    void createNote(db, user?.id ?? '', deviceId ?? '', { type, kind, title: '' }).then(
      ({ item }) => navigate(`/notes/${item.id}`),
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button size={size} onClick={() => make('note')}>
        New note
      </Button>
      <Button size={size} onClick={() => make('meeting')}>
        New meeting note
      </Button>
      <Button size={size} onClick={() => make('note', 'ink')}>
        New handwritten note
      </Button>
    </div>
  );
}
