import { Page } from '../../app/Page';
import LeaveCounter from '../leave/LeaveCounter';
import LeaveProposals from '../leave/LeaveProposals';
import Suggestions from './Suggestions';

export default function TodayPage() {
  return (
    <Page title="Today">
      <LeaveCounter />
      <LeaveProposals />
      <Suggestions />
      <p className="text-slate-500">Your day will show here.</p>
    </Page>
  );
}
