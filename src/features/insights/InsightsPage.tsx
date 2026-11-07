import { Page } from '../../app/Page';
import AiUsage from './AiUsage';

export default function InsightsPage() {
  return (
    <Page title="Insights">
      <section aria-labelledby="ai-usage-heading" className="mb-10">
        <h2
          id="ai-usage-heading"
          className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase"
        >
          AI usage
        </h2>
        <AiUsage />
      </section>
    </Page>
  );
}
