import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import { PAGE_KINDS, type Page as PageRow } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';
import { TextField } from '../../ui/TextField';

const KIND_TITLES: Record<PageRow['kind'], string> = {
  person: 'People',
  place: 'Places',
  project: 'Projects',
  series: 'Repeating events',
  topic: 'Topics',
};

const ago = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : null;

/** Library → Pages (Task 14.10): every active page, grouped by kind. */
export default function PagesPage() {
  const db = useDb();
  const pages = useLiveQuery(
    () => db.pages.filter((p) => !p.deleted_at && p.status === 'active').sortBy('name'),
    [db],
  );
  if (!pages) return <Page title="Pages" back={{ to: '/library', label: 'Library' }} />;
  return (
    <Page title="Pages" back={{ to: '/library', label: 'Library' }}>
      {pages.length === 0 ? (
        <EmptyState
          icon="library"
          title="No pages yet"
          message="Airhead keeps a page for each repeating event, topic, place you go to often, and the people and projects in your notes."
        />
      ) : (
        PAGE_KINDS.filter((k) => pages.some((p) => p.kind === k)).map((k) => (
          <Section key={k} title={KIND_TITLES[k]}>
            <GroupedList label={KIND_TITLES[k]}>
              {pages
                .filter((p) => p.kind === k)
                .map((p) => (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    subtitle={`${p.item_count} item${p.item_count === 1 ? '' : 's'}${p.last_item_at ? ` · last ${ago(p.last_item_at)}` : ''}`}
                    to={`/library/pages/${p.id}`}
                  />
                ))}
            </GroupedList>
          </Section>
        ))
      )}
    </Page>
  );
}

/** One page (Task 14.10): summary, facts, its items, and Rebuild, Rename, Archive. */
export function PageView() {
  const { id = '' } = useParams();
  const db = useDb();
  const page = useLiveQuery(() => db.pages.get(id), [db, id]);
  const items = useLiveQuery(async () => {
    const links = (await db.page_items.where('page_id').equals(id).toArray()).filter(
      (l) => !l.deleted_at,
    );
    const rows = await db.items.bulkGet(links.map((l) => l.item_id));
    return rows
      .flatMap((r, i) => (r && !r.deleted_at ? [{ item: r, note: links[i]?.note ?? null }] : []))
      .sort((a, b) =>
        (b.item.start_at ?? b.item.due_at ?? b.item.created_at).localeCompare(
          a.item.start_at ?? a.item.due_at ?? a.item.created_at,
        ),
      );
  }, [db, id]);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (page === undefined) return <Page title="Page" />;
  if (!page || page.deleted_at)
    return (
      <Page title="Not found" back={{ to: '/library/pages', label: 'Pages' }}>
        <EmptyState icon="library" title="Nothing here" message="This page doesn’t exist." />
      </Page>
    );
  const facts = (page.facts as { date?: string; text?: string }[]).filter((f) => f?.text);

  return (
    <Page title={page.name} back={{ to: '/library/pages', label: 'Pages' }}>
      <div className="space-y-5">
        <Section title="Summary">
          <GroupedList label="Summary">
            <GroupedListItem>
              <p className="text-body whitespace-pre-wrap">
                {page.summary || 'No summary yet. Airhead writes one overnight.'}
              </p>
              {page.rebuild_requested_at && (
                <p className="text-caption text-fg-muted">Rebuild asked for: tonight.</p>
              )}
            </GroupedListItem>
          </GroupedList>
        </Section>
        {facts.length > 0 && (
          <Section title="Facts">
            <GroupedList label="Facts">
              {facts.map((f, i) => (
                <GroupedListItem key={i}>
                  <p className="text-body">{f.text}</p>
                  {f.date && <p className="text-caption text-fg-muted">{f.date}</p>}
                </GroupedListItem>
              ))}
            </GroupedList>
          </Section>
        )}
        <Section title="Items">
          <GroupedList label="Items">
            {(items ?? []).map(({ item, note }) => (
              <ListRow
                key={item.id}
                title={item.title || 'Untitled'}
                subtitle={note ?? ago(item.start_at ?? item.due_at ?? item.created_at)}
                to={`/library/item/${item.id}`}
              />
            ))}
          </GroupedList>
        </Section>
        {renaming !== null ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming.trim()) return;
              void update(db, 'pages', page.id, { name: renaming.trim() }).then(() =>
                setRenaming(null),
              );
            }}
          >
            <TextField
              label="Name"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
            />
            <Button variant="primary" type="submit">
              Save
            </Button>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!!page.rebuild_requested_at}
              onClick={() =>
                void update(db, 'pages', page.id, {
                  rebuild_requested_at: new Date().toISOString(),
                })
              }
            >
              Rebuild
            </Button>
            <Button onClick={() => setRenaming(page.name)}>Rename</Button>
            <Button
              variant="destructive"
              onClick={() => void update(db, 'pages', page.id, { status: 'archived' })}
            >
              Archive
            </Button>
          </div>
        )}
        {page.status === 'archived' && (
          <p className="text-footnote text-fg-muted">
            Archived. <Link to="/library/pages">Back to Pages</Link>
          </p>
        )}
      </div>
    </Page>
  );
}

/** "On the page …" links from an item to every active page it belongs to. */
export function ItemPages({ itemId }: { itemId: string }) {
  const db = useDb();
  const pages = useLiveQuery(async () => {
    const links = (await db.page_items.where('item_id').equals(itemId).toArray()).filter(
      (l) => !l.deleted_at,
    );
    const rows = await db.pages.bulkGet(links.map((l) => l.page_id));
    return rows.filter((p): p is PageRow => !!p && !p.deleted_at && p.status === 'active');
  }, [db, itemId]);
  if (!pages?.length) return null;
  return (
    <Section title="Pages">
      <GroupedList label="Pages for this item">
        {pages.map((p) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={KIND_TITLES[p.kind]}
            to={`/library/pages/${p.id}`}
          />
        ))}
      </GroupedList>
    </Section>
  );
}
