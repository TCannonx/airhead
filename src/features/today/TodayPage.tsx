import { Link } from 'react-router';
import { Page } from '../../app/Page';
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
      <p className="mt-6 text-sm">
        <Link to="/review" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Evening review
        </Link>
      </p>
    </Page>
  );
}
