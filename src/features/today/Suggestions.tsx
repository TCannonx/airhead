import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { acceptSuggestion, dismissSuggestion, eventLabel } from '../../lib/db/events';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/** One-tap cards for dates the free rules weren't sure about. */
export default function Suggestions() {
  const db = useDb();
  const suggestions = useLiveQuery(
    () =>
      db.items
        .where('[type+status]')
        .equals(['event', 'suggested'])
        .filter((i) => !i.deleted_at)
        .sortBy('start_at'),
    [db],
  );
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <Section title="Suggestions">
      <GroupedList label="Suggestions">
        {suggestions.map((s) => (
          <GroupedListItem key={s.id}>
            <p className="text-body font-medium break-words">{s.title}</p>
            <p className="text-footnote text-fg-muted">
              {eventLabel(s)} · not sure about the date or time
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void acceptSuggestion(db, s.id)}>
                Add to calendar
              </Button>
              <Button size="sm" variant="plain" onClick={() => void dismissSuggestion(db, s.id)}>
                Dismiss
              </Button>
            </div>
          </GroupedListItem>
        ))}
      </GroupedList>
    </Section>
  );
}
