import { Page } from '../../app/Page';
import LeaveCounter from '../leave/LeaveCounter';
import LeaveProposals from '../leave/LeaveProposals';
import LocationPicker from '../work/LocationPicker';
import Suggestions from './Suggestions';

export default function TodayPage() {
  return (
    <Page title="Today">
      <LocationPicker />
      <LeaveCounter />
      <LeaveProposals />
      <Suggestions />
      <p className="text-slate-500">Your day will show here.</p>
    </Page>
  );
}
