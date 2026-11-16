import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  collateTopic,
  mergeTopics,
  readingTopics,
  renameTopic,
  topicToWorkshop,
} from '../../lib/db/topics';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';
import { Select } from '../../ui/Select';
import { TextField } from '../../ui/TextField';

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : '';

/** Library → Topics (Task 16.6): topics with 3 or more saved links. */
export default function TopicsPage() {
  const db = useDb();
  const topics = useLiveQuery(() => readingTopics(db), [db]);
  if (!topics) return <Page title="Topics" back={{ to: '/library', label: 'Library' }} />;
  return (
    <Page title="Topics" back={{ to: '/library', label: 'Library' }}>
      {topics.length === 0 ? (
        <EmptyState
          icon="library"
          title="No reading topics yet"
          message="Once you save three links on the same topic, Airhead gathers them here with a summary."
        />
      ) : (
        <GroupedList label="Topics">
          {topics.map((t) => (
            <ListRow
              key={t.topic.id}
              title={t.topic.name}
              subtitle={`${t.reading.length} links · last added ${day(t.lastAdded)}`}
              to={`/library/topics/${t.topic.id}`}
            />
          ))}
        </GroupedList>
      )}
    </Page>
  );
}

/** One topic (Task 16.6): summary, each link with its note, overlaps, questions, next step. */
export function TopicView() {
  const { id = '' } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const navigate = useNavigate();
  const all = useLiveQuery(() => readingTopics(db), [db]);
  const notes = useLiveQuery(async () => {
    const links = await db.page_items.filter((p) => !p.deleted_at && !!p.note).toArray();
    return new Map(links.map((l) => [`${l.page_id}|${l.item_id}`, l.note ?? '']));
  }, [db]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (!all) return <Page title="Topic" />;
  const t = all.find((x) => x.topic.id === id);
  if (!t)
    return (
      <Page title="Not found" back={{ to: '/library/topics', label: 'Topics' }}>
        <EmptyState
          icon="library"
          title="Nothing here"
          message="This topic has fewer than three links."
        />
      </Page>
    );
  const c = t.page?.collation ?? {};
  const others = all.filter((x) => x.topic.id !== id);

  return (
    <Page title={t.topic.name} back={{ to: '/library/topics', label: 'Topics' }}>
      <div className="space-y-5">
        <Section title="Summary">
          <GroupedList label="Topic summary">
            <GroupedListItem>
              <p className="text-body whitespace-pre-wrap">
                {t.page?.summary || 'Airhead collates this topic overnight.'}
              </p>
              {t.page?.rebuild_requested_at && (
                <p className="text-caption text-fg-muted">Collating again tonight.</p>
              )}
            </GroupedListItem>
          </GroupedList>
        </Section>
        <Section title="Links">
          <GroupedList label="Links">
            {t.reading.map((i) => (
              <ListRow
                key={i.id}
                title={i.title}
                subtitle={(t.page && notes?.get(`${t.page.id}|${i.id}`)) || day(i.created_at)}
                to={`/library/item/${i.id}`}
              />
            ))}
          </GroupedList>
        </Section>
        {(c.overlaps?.length ?? 0) > 0 && (
          <Section title="Where sources agree or differ">
            <GroupedList label="Overlaps">
              {c.overlaps?.map((o) => (
                <GroupedListItem key={o}>
                  <p className="text-body">{o}</p>
                </GroupedListItem>
              ))}
            </GroupedList>
          </Section>
        )}
        {(c.open_questions?.length ?? 0) > 0 && (
          <Section title="Open questions">
            <GroupedList label="Open questions">
              {c.open_questions?.map((q) => (
                <GroupedListItem key={q}>
                  <p className="text-body">{q}</p>
                </GroupedListItem>
              ))}
            </GroupedList>
          </Section>
        )}
        {c.next_step && (
          <p className="text-body">
            <span className="text-fg-muted">Next step: </span>
            {c.next_step}
          </p>
        )}

        {renaming !== null ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void renameTopic(db, t, renaming).then(() => setRenaming(null));
            }}
          >
            <TextField
              label="Topic name"
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
              disabled={!t.page || !!t.page.rebuild_requested_at}
              onClick={() => t.page && void collateTopic(db, t.page)}
            >
              Collate
            </Button>
            <Button
              onClick={() =>
                void topicToWorkshop(db, user?.id ?? '', t).then((idea) =>
                  navigate(`/workshop/${idea.id}`),
                )
              }
            >
              Send to Workshop
            </Button>
            <Button onClick={() => setRenaming(t.topic.name)}>Rename</Button>
          </div>
        )}
        {others.length > 0 && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const into = others.find((o) => o.topic.id === mergeInto);
              if (!into) return;
              void mergeTopics(db, t, into.topic).then(() => {
                setMessage(`Merged into ${into.topic.name}.`);
                void navigate(`/library/topics/${into.topic.id}`);
              });
            }}
          >
            <Select
              label="Merge with"
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
              options={[
                { value: '', label: 'Choose a topic' },
                ...others.map((o) => ({ value: o.topic.id, label: o.topic.name })),
              ]}
            />
            <Button type="submit" disabled={!mergeInto}>
              Merge
            </Button>
          </form>
        )}
        {message && (
          <p role="status" className="text-footnote text-fg-muted">
            {message}
          </p>
        )}
      </div>
    </Page>
  );
}
