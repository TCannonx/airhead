import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { openFollowUps } from '../../lib/db/followUps';
import { GroupedList, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';

/** "Airhead has N questions" while any are open (Task 12.2); opens the Inbox. */
export default function QuestionsCard() {
  const db = useDb();
  const open = useLiveQuery(async () => (await openFollowUps(db)).length, [db]);
  if (!open) return null;
  return (
    <Section>
      <GroupedList>
        <ListRow
          icon="info"
          title={`Airhead has ${open} question${open === 1 ? '' : 's'}`}
          subtitle="Quick answers help it plan for you"
          to="/inbox"
        />
      </GroupedList>
    </Section>
  );
}
