import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Page';
import ReadingDetails from './ReadingDetails';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { eventLabel } from '../../lib/db/events';
import { softDelete, update } from '../../lib/db/repository';
import { changeItemType, SORTABLE_TYPES, TYPE_LABELS } from '../../lib/db/sorting';
import { inWorkshop, leaveWorkshop, sendToWorkshop } from '../../lib/db/workshop';
import type { Item, ItemType } from '../../lib/schemas/records';
import { Top3Button } from '../today/Top3Controls';

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';

export default function ItemPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const item = useLiveQuery(() => db.items.get(id), [db, id]);

  if (item === undefined) return <Page title="Item" />;
  // Notes and meeting notes open in the note editor (Task 6.3).
  if (item && !item.deleted_at && typeof item.data.doc_kind === 'string')
    return <Navigate to={`/notes/${item.id}`} replace />;
  if (!item || item.deleted_at) {
    return (
      <Page title="Not found">
        <p className="text-slate-500">This item doesn&apos;t exist or is in the Trash.</p>
        <Link to="/library" className="text-indigo-600 underline">
          Back to Library
        </Link>
      </Page>
    );
  }
  // Keyed by id: the form starts from the item once; later live updates don't overwrite typing.
  return <ItemForm key={item.id} item={item} />;
}

function ItemForm({ item }: { item: Item }) {
  const db = useDb();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body ?? '');
  const [type, setType] = useState<ItemType>(item.type);
  const id = item.id;

  async function onSave() {
    await update(db, 'items', id, { title: title.trim(), body: body.trim() || null });
    if (type !== item.type) await changeItemType(db, user?.id ?? '', id, type);
  }

  async function onDelete() {
    await softDelete(db, 'items', id);
    void navigate('/library');
  }

  return (
    <Page title={item.title || 'Item'}>
      <div className="space-y-4">
        <label className="block space-y-1 text-sm font-medium">
          <span>Title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          <span>Type</span>
          <select
            className={field}
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
          >
            {SORTABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {item.type === 'event' && item.start_at && (
          <p className="text-sm text-slate-500">
            When: {eventLabel(item)}
            {item.rrule && ' · repeats'}
          </p>
        )}
        {typeof item.data.url === 'string' && (
          <p className="text-sm">
            <a
              href={item.data.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-indigo-600 underline"
            >
              {item.data.url}
            </a>
          </p>
        )}
        <ReadingDetails item={item} />
        <label className="block space-y-1 text-sm font-medium">
          <span>Notes</span>
          <textarea
            className={field}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() => void onSave()}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => void onDelete()}
          >
            Delete
          </button>
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() =>
              void (inWorkshop(item) ? leaveWorkshop(db, item) : sendToWorkshop(db, item))
            }
          >
            {inWorkshop(item) ? 'Take out of the Workshop' : 'Send to the Workshop'}
          </button>
        </div>
        <Top3Button item={item} />
      </div>
    </Page>
  );
}
