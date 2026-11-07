import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  addEntry,
  clearCompleted,
  createList,
  ensureDefaultList,
  listEntries,
  moveList,
  renameList,
  toggleEntry,
} from '../../lib/db/lists';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';
const small =
  'rounded-lg px-2.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800';

export default function ListsPage() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [selected, setSelected] = useState<string | null>(null);
  const [newList, setNewList] = useState('');
  const [entry, setEntry] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    void ensureDefaultList(db, userId).catch(() => {});
  }, [db, userId]);

  const lists = useLiveQuery(
    () =>
      db.lists
        .orderBy('sort_order')
        .filter((l) => !l.deleted_at)
        .toArray(),
    [db],
  );
  const items = useLiveQuery(() => db.items.where('type').equals('list_entry').toArray(), [db]);
  const current = lists?.find((l) => l.id === selected) ?? lists?.[0];
  const entries = current && items ? listEntries(items, current.id) : [];
  const index = current && lists ? lists.findIndex((l) => l.id === current.id) : -1;

  async function onNewList(e: FormEvent) {
    e.preventDefault();
    if (!newList.trim()) return;
    const list = await createList(db, userId, newList);
    setNewList('');
    setSelected(list.id);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!current || !entry.trim()) return;
    await addEntry(db, userId, current.id, entry);
    setEntry('');
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (current && renaming?.trim()) await renameList(db, current.id, renaming);
    setRenaming(null);
  }

  return (
    <Page title="Lists">
      <p className="mb-4 text-sm">
        <Link to="/library" className="text-slate-500 underline">
          Back to Library
        </Link>
      </p>
      <div role="group" aria-label="Lists" className="mb-3 flex flex-wrap gap-1.5">
        {lists?.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.id === current?.id}
            onClick={() => setSelected(l.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              l.id === current?.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => void onNewList(e)} className="mb-6 flex gap-2">
        <input
          aria-label="New list"
          placeholder="New list (e.g. Packing)"
          className={input}
          value={newList}
          onChange={(e) => setNewList(e.target.value)}
        />
        <button type="submit" className={`${small} shrink-0 bg-slate-100 dark:bg-slate-800`}>
          Create
        </button>
      </form>

      {current && (
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {renaming !== null ? (
              <form onSubmit={(e) => void onRename(e)} className="flex flex-1 gap-2">
                <input
                  aria-label="List name"
                  className={input}
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  autoFocus
                />
                <button type="submit" className={small}>
                  Save
                </button>
              </form>
            ) : (
              <h2 className="text-lg font-semibold">{current.name}</h2>
            )}
            <div className="flex gap-1">
              <button type="button" className={small} onClick={() => setRenaming(current.name)}>
                Rename
              </button>
              <button
                type="button"
                className={small}
                disabled={index <= 0}
                onClick={() => void moveList(db, userId, current.id, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                className={small}
                disabled={!lists || index >= lists.length - 1}
                onClick={() => void moveList(db, userId, current.id, 1)}
              >
                Move down
              </button>
            </div>
          </div>

          <form onSubmit={(e) => void onAdd(e)} className="mb-3">
            <input
              aria-label={`Add to ${current.name}`}
              placeholder="Add an item and press Enter"
              className={input}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </form>

          {entries.length === 0 && <p className="text-sm text-slate-500">Nothing on this list.</p>}
          <ul
            aria-label={`${current.name} entries`}
            className="divide-y divide-slate-100 dark:divide-slate-800"
          >
            {entries.map((i) => (
              <li key={i.id} className="py-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-indigo-600"
                    checked={i.status === 'done'}
                    onChange={() => void toggleEntry(db, i.id)}
                  />
                  <span className={i.status === 'done' ? 'text-slate-400 line-through' : ''}>
                    {i.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className={`${small} mt-3`}
            disabled={!entries.some((i) => i.status === 'done')}
            onClick={() => void clearCompleted(db, current.id)}
          >
            Clear completed
          </button>
        </section>
      )}
    </Page>
  );
}
