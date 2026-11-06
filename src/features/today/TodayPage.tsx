import { Page } from '../../app/Page';
import Suggestions from './Suggestions';

export default function TodayPage() {
  return (
    <Page title="Today">
      <Suggestions />
      <p className="text-slate-500">Your day will show here.</p>
    </Page>
  );
}
