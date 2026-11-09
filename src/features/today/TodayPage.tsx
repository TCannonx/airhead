import { Page } from '../../app/Page';
import { GroupedList, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';
import LeaveCounter from '../leave/LeaveCounter';
import LeaveProposals from '../leave/LeaveProposals';
import LocationPicker from '../work/LocationPicker';
import ScoutCards from './ScoutCards';
import Suggestions from './Suggestions';
import { CarryOverCards } from './Top3Controls';
import { AlsoToday, BriefLines, Top3, TodayEvents } from './TodayParts';
import { useToday } from './useToday';

/** Today (Task 5.7): brief, events, Top 3 with slots, Also today, suggestion cards. */
export default function TodayPage() {
  const view = useToday();
  return (
    <Page title="Today">
      <LocationPicker />
      {view && (
        <>
          <BriefLines view={view} />
          <TodayEvents view={view} />
          <Top3 view={view} />
          <AlsoToday view={view} />
        </>
      )}
      <CarryOverCards />
      <LeaveProposals />
      <Suggestions />
      <ScoutCards />
      <LeaveCounter />
      <Section>
        <GroupedList>
          <ListRow icon="check" iconTint="bg-success" title="Evening review" to="/review" />
        </GroupedList>
      </Section>
    </Page>
  );
}
