import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { repeatText } from '../../lib/rules/repeatText';
import { beforeText, prepRulesFor, readWorkSettings } from '../../lib/work/settings';
import ReadingDetails from './ReadingDetails';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { endLabel, eventLabel } from '../../lib/db/events';
import { softDelete, update } from '../../lib/db/repository';
import { changeItemType, SORTABLE_TYPES, TYPE_LABELS } from '../../lib/db/sorting';
import { inWorkshop, leaveWorkshop, sendToWorkshop } from '../../lib/db/workshop';
import type { Item, ItemType } from '../../lib/schemas/records';
import { Top3Button } from '../today/Top3Controls';
import { FollowUpList } from '../inbox/FollowUps';
import { Receipt } from '../capture/Receipt';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { Button } from '../../ui/Button';
import { buttonClasses } from '../../ui/buttonClasses';
import { EmptyState } from '../../ui/EmptyState';
import { Card } from '../../ui/Card';
import { Select } from '../../ui/Select';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';

/** "Mon 23 Nov, 09:00" in the device's zone. */
function dueLabel(at: string): string {
  return new Date(at).toLocaleString('en-IE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
      <Page title="Not found" back={{ to: '/library', label: 'Library' }}>
        <EmptyState
          icon="library"
          title="Nothing here"
          message="This item doesn’t exist or is in the Trash."
          action={
            <Link to="/library" className={buttonClasses('secondary', 'md')}>
              Back to Library
            </Link>
          }
        />
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
  const settings = useLiveQuery(() => db.settings.get(user?.id ?? ''), [db, user?.id]);
  // The capture this item came from, and what Airhead did with it (Task 12.3).
  const source = useLiveQuery(
    async () => (item.capture_id ? ((await db.captures.get(item.capture_id)) ?? null) : null),
    [db, item.capture_id],
  );
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

  const meta = 'text-footnote text-fg-muted';
  return (
    <Page title={item.title || 'Item'} back={{ to: '/library', label: 'Library' }}>
      <div className="space-y-5">
        <Card className="space-y-4">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
            options={SORTABLE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
          />
          {item.type === 'event' && item.start_at && (
            <p className={meta}>
              When: {eventLabel(item)}
              {endLabel(item)}
              {item.rrule && ' · repeats'}
            </p>
          )}
          {item.type === 'event' &&
            !item.rrule &&
            prepRulesFor(item.title, readWorkSettings(settings).prep_rules).map((r) => (
              <p key={r.id} className={meta}>
                Before this: {r.reminder} ({beforeText(r.minutes_before)})
              </p>
            ))}
          {item.type === 'task' && (item.due_at || item.rrule) && (
            <p className={meta}>
              {item.due_at && `Due: ${dueLabel(item.due_at)}`}
              {item.due_at && item.rrule && ' · '}
              {item.rrule && `repeats ${repeatText(item.rrule)}`}
            </p>
          )}
          {typeof item.data.url === 'string' && (
            <p className="text-footnote break-all">
              <a
                href={item.data.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline"
              >
                {item.data.url}
              </a>
            </p>
          )}
          <TextArea label="Notes" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Card>
        <FollowUpList itemId={item.id} title="Questions about this" showSource={false} />
        {source && !source.deleted_at && (
          <Section title="From your note">
            <GroupedList label="From your note">
              <GroupedListItem>
                <p className="text-body break-words whitespace-pre-wrap">
                  {source.text ?? source.url}
                </p>
                <Receipt capture={source} />
              </GroupedListItem>
            </GroupedList>
          </Section>
        )}
        <ReadingDetails item={item} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void onSave()}>
            Save
          </Button>
          <Button
            onClick={() =>
              void (inWorkshop(item) ? leaveWorkshop(db, item) : sendToWorkshop(db, item))
            }
          >
            {inWorkshop(item) ? 'Take out of Workshop' : 'Send to Workshop'}
          </Button>
          <Button variant="destructive" className="ml-auto" onClick={() => void onDelete()}>
            Delete
          </Button>
        </div>
        {inWorkshop(item) && (
          <Link to={`/workshop/${item.id}`} className={buttonClasses('plain', 'sm', '-ml-3')}>
            Open in the Workshop
          </Link>
        )}
        <Top3Button item={item} />
      </div>
    </Page>
  );
}
