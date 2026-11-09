import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { saveDoc } from '../../lib/db/notes';
import { update } from '../../lib/db/repository';
import { inWorkshop, leaveWorkshop, sendToWorkshop } from '../../lib/db/workshop';
import { detectPlatform } from '../../lib/device';
import { readInk } from '../../lib/ink/strokes';
import { readSummary } from '../../lib/notes/summary';
import InkCanvas from './InkCanvas';
import InkView from './InkView';
import MeetingDetails from './MeetingDetails';
import NoteEditor from './NoteEditor';
import SummarisePanel from './SummarisePanel';
import { Button } from '../../ui/Button';

/** The iPad (with its Pencil) is where pages are written; elsewhere summarised pages are read. */
const writesPages = () =>
  typeof navigator !== 'undefined' &&
  detectPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ipados';

/**
 * A note or meeting note (Task 6.3): its title and its document. Once
 * summarised (Task 6.9) the summary sits above the original, and handwritten
 * pages are view-only on phone and desktop (editable on the iPad, or on a tap).
 */
export default function NotePage() {
  const { id = '' } = useParams();
  const db = useDb();
  const { deviceId } = useAuth();
  const data = useLiveQuery(
    async () => ({ item: await db.items.get(id), doc: await db.note_docs.get(id) }),
    [db, id],
  );
  const [title, setTitle] = useState<string | null>(null);
  const [editPages, setEditPages] = useState(false);

  if (!data) return <Page title="Note" />;
  const { item, doc } = data;
  if (!item || item.deleted_at || !doc) {
    return (
      <Page title="Not found">
        <p className="text-fg-muted">This note doesn&apos;t exist or is in the Trash.</p>
        <Link to="/library" className="text-accent underline">
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
      <div
        className="mb-4 flex flex-wrap items-center gap-3 text-footnote"
        aria-label="Note menu"
        role="group"
      >
        <Button
          size="sm"
          onClick={() =>
            void (inWorkshop(item) ? leaveWorkshop(db, item) : sendToWorkshop(db, item))
          }
        >
          {inWorkshop(item) ? 'Take out of Workshop' : 'Send to Workshop'}
        </Button>
        {inWorkshop(item) && (
          <Link to={`/workshop/${item.id}`} className="text-accent hover:underline">
            Open in the Workshop
          </Link>
        )}
      </div>
      {item.type === 'meeting' && <MeetingDetails key={item.id} item={item} />}
      <SummarisePanel item={item} doc={doc} />
      {doc.kind === 'typed' ? (
        // Keyed by id: switching notes starts a fresh editor.
        <NoteEditor
          key={doc.id}
          html={typeof doc.doc.html === 'string' ? doc.doc.html : ''}
          onSave={(html) => void saveDoc(db, deviceId ?? '', doc.id, { ...doc.doc, html })}
        />
      ) : readSummary(item) && !writesPages() && !editPages ? (
        <>
          <Button variant="plain" size="sm" className="mb-2" onClick={() => setEditPages(true)}>
            Edit pages
          </Button>
          <InkView doc={readInk(doc.doc)} />
        </>
      ) : (
        <InkCanvas
          key={doc.id}
          doc={readInk(doc.doc)}
          onSave={(ink) => void saveDoc(db, deviceId ?? '', doc.id, { ...ink })}
        />
      )}
    </Page>
  );
}
