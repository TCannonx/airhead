import { Link } from 'react-router';
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
      <p className="mt-6 text-sm">
        <Link to="/review" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Evening review
        </Link>
      </p>
    </Page>
  );
}
