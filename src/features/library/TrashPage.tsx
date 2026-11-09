import { useLiveQuery } from 'dexie-react-hooks';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { restore } from '../../lib/db/repository';
import { trashItems, TRASH_DAYS, TYPE_LABELS } from '../../lib/db/sorting';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';

export default function TrashPage() {
  const db = useDb();
  const items = useLiveQuery(() => db.items.toArray(), [db]);
  const trash = items ? trashItems(items) : undefined;

  return (
    <Page title="Trash" back={{ to: '/library', label: 'Library' }}>
      <Section
        footer={`Deleted items can be restored here. They are deleted for good after ${TRASH_DAYS} days.`}
      >
        {trash && trash.length === 0 ? (
          <GroupedList>
            <li>
              <EmptyState icon="trash" title="The Trash is empty." className="py-6" />
            </li>
          </GroupedList>
        ) : (
          <GroupedList label="Trash">
            {trash?.map((i) => (
              <ListRow
                key={i.id}
                title={<span className="block truncate">{i.title || '(untitled)'}</span>}
                subtitle={TYPE_LABELS[i.type]}
                trailing={
                  <Button size="sm" onClick={() => void restore(db, 'items', i.id)}>
                    Restore
                  </Button>
                }
              />
            ))}
          </GroupedList>
        )}
      </Section>
    </Page>
  );
}
