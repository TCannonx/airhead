import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { filterLibrary, TYPE_LABELS } from '../../lib/db/sorting';
import { useSearch } from '../../lib/search/useSearch';
import type { ItemType } from '../../lib/schemas/records';
import NewNoteButtons from '../notes/NewNoteButtons';
import AskPanel from './AskPanel';

const TABS: { label: string; type: ItemType | null }[] = [
  { label: 'All', type: null },
  { label: 'Tasks', type: 'task' },
  { label: 'Events', type: 'event' },
  { label: 'Reading', type: 'reading' },
  { label: 'Ideas', type: 'idea' },
  { label: 'Meetings', type: 'meeting' },
  { label: 'Notes', type: 'note' },
];

const input =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';

export default function LibraryPage() {
  const db = useDb();
  const [type, setType] = useState<ItemType | null>(null);
  const [topicId, setTopicId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const focusSearch = (location.state as { focusSearch?: number } | null)?.focusSearch;
  const results = useSearch(db, query);

  // "/" (desktop) navigates here asking for the search box.
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const items = useLiveQuery(() => db.items.toArray(), [db]);
  const topics = useLiveQuery(() => db.topics.filter((t) => !t.deleted_at).sortBy('name'), [db]);
  const shown = items ? filterLibrary(items, { type, topicId, from, to }) : undefined;
  const topicName = new Map(topics?.map((t) => [t.id, t.name]));

  return (
    <Page title="Library">
      <AskPanel />
      <input
        ref={searchRef}
        type="search"
        aria-label="Search"
        placeholder="Search everything (press / on desktop)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900"
      />

      {query.trim() ? (
        <>
          {results && results.length === 0 && (
            <p className="text-sm text-slate-500">No matches for “{query.trim()}”.</p>
          )}
          <ul
            aria-label="Search results"
            className="divide-y divide-slate-200 dark:divide-slate-800"
          >
            {results?.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <Link
                  to={r.kind === 'item' ? `/library/item/${r.id}` : '/inbox'}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <span className="min-w-0 flex-1 truncate">{r.title || '(untitled)'}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {r.itemType ? TYPE_LABELS[r.itemType] : 'Capture'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.label}
                type="button"
                aria-pressed={type === t.type}
                onClick={() => setType(t.type)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  type === t.type
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Topic
              <select
                className={input}
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
              >
                <option value="">Any topic</option>
                {topics?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              From
              <input
                type="date"
                className={input}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              To
              <input
                type="date"
                className={input}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <NewNoteButtons />
            <Link to="/library/lists" className="ml-auto text-sm text-slate-500 underline">
              Lists
            </Link>
            <Link to="/library/trash" className="text-sm text-slate-500 underline">
              Trash
            </Link>
          </div>

          {shown && shown.length === 0 && (
            <p className="text-sm text-slate-500">Nothing here yet.</p>
          )}
          <ul aria-label="Items" className="divide-y divide-slate-200 dark:divide-slate-800">
            {shown?.map((i) => (
              <li key={i.id}>
                <Link
                  to={`/library/item/${i.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <span className="min-w-0 flex-1 truncate">{i.title || '(untitled)'}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {i.topic_ids
                      .map((id) => topicName.get(id))
                      .filter(Boolean)
                      .join(', ')}
                    {i.topic_ids.length > 0 && ' · '}
                    {TYPE_LABELS[i.type]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
