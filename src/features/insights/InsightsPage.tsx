import { Page } from '../../app/Page';
import CheckupPanel from '../settings/CheckupPanel';
import LocationInsights from './LocationInsights';
import AiUsage from './AiUsage';
import SuccessMeasures from './SuccessMeasures';
import WeeklyReview from './WeeklyReview';
import Patterns from './Patterns';

export default function InsightsPage() {
  return (
    <Page title="Insights">
      <section aria-labelledby="week-heading" className="mb-10">
        <h2
          id="week-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          This week
        </h2>
        <WeeklyReview />
      </section>
      <section aria-labelledby="patterns-heading" className="mb-10">
        <h2
          id="patterns-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          Patterns
        </h2>
        <Patterns />
      </section>
      <section aria-labelledby="measures-heading" className="mb-10">
        <h2
          id="measures-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          Success measures
        </h2>
        <SuccessMeasures />
      </section>
      <section aria-labelledby="ai-usage-heading" className="mb-10">
        <h2
          id="ai-usage-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          AI usage
        </h2>
        <AiUsage />
      </section>
      <section aria-labelledby="checkup-heading" className="mb-10">
        <h2
          id="checkup-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          Memory check-up
        </h2>
        <CheckupPanel auto />
      </section>
      <section aria-labelledby="location-heading" className="mb-10">
        <h2
          id="location-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          Where I worked
        </h2>
        <LocationInsights />
      </section>
    </Page>
  );
}
