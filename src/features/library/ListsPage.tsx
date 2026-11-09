import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
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
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { cx } from '../../ui/cx';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { TextField } from '../../ui/TextField';


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
    <Page title="Lists" back={{ to: '/library', label: 'Library' }}>
      <div role="group" aria-label="Lists" className="mb-5 flex flex-wrap gap-2">
        {lists?.map((l) => (
          <Chip
            key={l.id}
            selected={l.id === current?.id}
            onClick={() => setSelected(l.id)}
            className="pointer-coarse:min-h-11"
          >
            {l.name}
          </Chip>
        ))}
      </div>

      {current && (
        <Section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            {renaming !== null ? (
              <form onSubmit={(e) => void onRename(e)} className="flex flex-1 items-end gap-2">
                <TextField
                  label="List name"
                  hideLabel
                  className="flex-1"
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  autoFocus
                />
                <Button type="submit" variant="primary">
                  Save
                </Button>
              </form>
            ) : (
              <h2 className="text-headline">{current.name}</h2>
            )}
            <div className="-mr-2 flex gap-1">
              <Button size="sm" variant="plain" onClick={() => setRenaming(current.name)}>
                Rename
              </Button>
              <Button
                size="sm"
                variant="plain"
                disabled={index <= 0}
                onClick={() => void moveList(db, userId, current.id, -1)}
              >
                Move up
              </Button>
              <Button
                size="sm"
                variant="plain"
                disabled={!lists || index >= lists.length - 1}
                onClick={() => void moveList(db, userId, current.id, 1)}
              >
                Move down
              </Button>
            </div>
          </div>

          <form onSubmit={(e) => void onAdd(e)} className="mb-3">
            <TextField
              label={`Add to ${current.name}`}
              hideLabel
              placeholder="Add an item and press Enter"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </form>

          {entries.length === 0 ? (
            <GroupedList>
              <GroupedListItem>
                <p className="text-body text-fg-muted">Nothing on this list.</p>
              </GroupedListItem>
            </GroupedList>
          ) : (
            <GroupedList label={`${current.name} entries`}>
              {entries.map((i) => (
                <li key={i.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 cursor-pointer accent-accent"
                      checked={i.status === 'done'}
                      onChange={() => void toggleEntry(db, i.id)}
                    />
                    <span
                      className={cx(
                        'text-body break-words',
                        i.status === 'done' && 'text-fg-subtle line-through',
                      )}
                    >
                      {i.title}
                    </span>
                  </label>
                </li>
              ))}
            </GroupedList>
          )}

          <Button
            size="sm"
            variant="plain"
            className="mt-2"
            disabled={!entries.some((i) => i.status === 'done')}
            onClick={() => void clearCompleted(db, current.id)}
          >
            Clear completed
          </Button>
        </Section>
      )}

      <Section title="New list">
        <form onSubmit={(e) => void onNewList(e)} className="flex items-end gap-2">
          <TextField
            label="New list"
            hideLabel
            placeholder="New list (e.g. Packing)"
            className="flex-1"
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
          />
          <Button type="submit">Create</Button>
        </form>
      </Section>
    </Page>
  );
}
