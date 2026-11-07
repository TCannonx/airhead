import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { restore } from '../../lib/db/repository';
import { trashItems, TRASH_DAYS, TYPE_LABELS } from '../../lib/db/sorting';

export default function TrashPage() {
  const db = useDb();
  const items = useLiveQuery(() => db.items.toArray(), [db]);
  const trash = items ? trashItems(items) : undefined;

  return (
    <Page title="Trash">
      <p className="mb-4 text-sm text-slate-500">
        Deleted items can be restored here. They are deleted for good after {TRASH_DAYS} days.{' '}
        <Link to="/library" className="underline">
          Back to Library
        </Link>
      </p>
      {trash && trash.length === 0 && <p className="text-sm text-slate-500">The Trash is empty.</p>}
      <ul aria-label="Trash" className="divide-y divide-slate-200 dark:divide-slate-800">
        {trash?.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate">{i.title || '(untitled)'}</span>
            <span className="text-xs text-slate-500">{TYPE_LABELS[i.type]}</span>
            <button
              type="button"
              className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-medium hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
              onClick={() => void restore(db, 'items', i.id)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
