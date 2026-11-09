import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { filterLibrary, TYPE_LABELS } from '../../lib/db/sorting';
import { useSearch } from '../../lib/search/useSearch';
import type { ItemType } from '../../lib/schemas/records';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, Section } from '../../ui/GroupedList';
import { Icon } from '../../app/Icon';
import { ListRow } from '../../ui/ListRow';
import { Select } from '../../ui/Select';
import { TextField } from '../../ui/TextField';
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

/** One row of the item list or search results: title on the left, kind on the right. */
function ItemLink({ to, title, kind }: { to: string; title: string; kind: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 items-center gap-3 px-4 py-2.5 transition outline-none hover:bg-fill/60 focus-visible:bg-fill active:bg-fill"
      >
        <span className="min-w-0 flex-1 truncate text-body">{title || '(untitled)'}</span>
        <span className="max-w-[45%] shrink-0 truncate text-footnote text-fg-muted">{kind}</span>
        <Icon name="chevron-right" className="size-4 shrink-0 text-fg-subtle" />
      </Link>
    </li>
  );
}

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
      <TextField
        ref={searchRef}
        type="search"
        label="Search"
        hideLabel
        placeholder="Search everything (press / on desktop)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6"
      />

      {query.trim() ? (
        <Section title="Results">
          {results && results.length === 0 ? (
            <GroupedList>
              <li>
                <EmptyState
                  icon="search"
                  title="Nothing found"
                  message={`No matches for “${query.trim()}”.`}
                  className="py-6"
                />
              </li>
            </GroupedList>
          ) : (
            <GroupedList label="Search results">
              {results?.map((r) => (
                <ItemLink
                  key={`${r.kind}:${r.id}`}
                  to={r.kind === 'item' ? `/library/item/${r.id}` : '/inbox'}
                  title={r.title}
                  kind={r.itemType ? TYPE_LABELS[r.itemType] : 'Capture'}
                />
              ))}
            </GroupedList>
          )}
        </Section>
      ) : (
        <>
          <Section>
            <GroupedList>
              <ListRow icon="list" iconTint="bg-accent" title="Lists" to="/library/lists" />
              <ListRow icon="trash" iconTint="bg-fg-subtle" title="Trash" to="/library/trash" />
            </GroupedList>
          </Section>

          <Section title="Notes">
            <NewNoteButtons />
          </Section>

          <Section title="Everything">
            <div className="mb-3 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Chip
                  key={t.label}
                  selected={type === t.type}
                  onClick={() => setType(t.type)}
                  className="pointer-coarse:min-h-11"
                >
                  {t.label}
                </Chip>
              ))}
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select
                label="Topic"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                options={[
                  { value: '', label: 'Any topic' },
                  ...(topics ?? []).map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
              <TextField
                label="From"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <TextField
                label="To"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            {shown && shown.length === 0 ? (
              <GroupedList>
                <li>
                  <EmptyState
                    icon="library"
                    title="Nothing here yet"
                    message="Captures land here once they are sorted."
                    className="py-6"
                  />
                </li>
              </GroupedList>
            ) : (
              <GroupedList label="Items">
                {shown?.map((i) => (
                  <ItemLink
                    key={i.id}
                    to={`/library/item/${i.id}`}
                    title={i.title}
                    kind={[
                      i.topic_ids
                        .map((id) => topicName.get(id))
                        .filter(Boolean)
                        .join(', '),
                      TYPE_LABELS[i.type],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </GroupedList>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
