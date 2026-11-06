import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { eventLabel } from '../../lib/db/events';
import { softDelete, update } from '../../lib/db/repository';
import { changeItemType, SORTABLE_TYPES, TYPE_LABELS } from '../../lib/db/sorting';
import type { ItemType } from '../../lib/schemas/records';

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';

export default function ItemPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const navigate = useNavigate();
  const item = useLiveQuery(() => db.items.get(id), [db, id]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<ItemType>('note');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Load the item into the form once (later live updates don't overwrite typing).
  useEffect(() => {
    if (item && loadedId !== item.id) {
      setTitle(item.title);
      setBody(item.body ?? '');
      setType(item.type);
      setLoadedId(item.id);
    }
  }, [item, loadedId]);

  if (item === undefined) return <Page title="Item" />;
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

  async function onSave() {
    await update(db, 'items', id, { title: title.trim(), body: body.trim() || null });
    if (type !== item?.type) await changeItemType(db, user?.id ?? '', id, type);
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
        </div>
      </div>
    </Page>
  );
}
