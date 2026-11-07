import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { saveDoc } from '../../lib/db/notes';
import { update } from '../../lib/db/repository';
import NoteEditor from './NoteEditor';

/** A note or meeting note (Task 6.3): its title and its document. */
export default function NotePage() {
  const { id = '' } = useParams();
  const db = useDb();
  const { deviceId } = useAuth();
  const data = useLiveQuery(
    async () => ({ item: await db.items.get(id), doc: await db.note_docs.get(id) }),
    [db, id],
  );
  const [title, setTitle] = useState<string | null>(null);

  if (!data) return <Page title="Note" />;
  const { item, doc } = data;
  if (!item || item.deleted_at || !doc) {
    return (
      <Page title="Not found">
        <p className="text-slate-500">This note doesn&apos;t exist or is in the Trash.</p>
        <Link to="/library" className="text-indigo-600 underline">
          Back to Library
        </Link>
      </Page>
    );
  }

  return (
    <Page title={item.type === 'meeting' ? 'Meeting notes' : 'Note'}>
      <input
        aria-label="Title"
        className="mb-4 w-full bg-transparent text-xl font-semibold outline-none"
        value={title ?? item.title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== null && title.trim() && title !== item.title)
            void update(db, 'items', item.id, { title: title.trim() });
        }}
      />
      {doc.kind === 'typed' ? (
        // Keyed by id: switching notes starts a fresh editor.
        <NoteEditor
          key={doc.id}
          html={typeof doc.doc.html === 'string' ? doc.doc.html : ''}
          onSave={(html) => void saveDoc(db, deviceId ?? '', doc.id, { ...doc.doc, html })}
        />
      ) : (
        <p className="text-sm text-slate-500">Handwritten pages open here.</p>
      )}
    </Page>
  );
}
