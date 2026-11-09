import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { hourLabel, patternsFrom, WEEKDAYS } from '../../lib/review/patterns';
import Bars from './Bars';

/** Insights → Patterns (Task 8.6): habits from the last 8 weekly reviews, no AI. */
export default function Patterns() {
  const db = useDb();
  const reviews = useLiveQuery(() => db.reviews.toArray(), [db]);
  if (!reviews) return null;
  const p = patternsFrom(reviews);
  if (p.weeks === 0)
    return (
      <p className="text-footnote text-fg-muted">Patterns appear after the first weekly review.</p>
    );
  const done = p.perWeek.reduce((s, w) => s + w.done, 0);
  const due = p.perWeek.reduce((s, w) => s + w.due, 0);

  return (
    <div className="space-y-6 text-footnote">
      <p className="text-fg-muted">
        Over the last {p.weeks} {p.weeks === 1 ? 'week' : 'weeks'}: {done} tasks done
        {due > 0 && ` (${Math.round((Math.min(done, due) / due) * 100)}% of those due)`}.
      </p>
      <Bars
        title="Tasks done by weekday"
        labelHeading="Day"
        valueLabel="Done"
        bars={WEEKDAYS.map((label, i) => ({ label, value: p.completionWeekdays[i] ?? 0 }))}
      />
      <Bars
        title="When you capture"
        labelHeading="Hour"
        valueLabel="Captures"
        bars={p.captureHours.map((value, h) => ({ label: hourLabel(h), value }))}
      />
      <Bars
        title="When you finish tasks"
        labelHeading="Hour"
        valueLabel="Done"
        bars={p.completionHours.map((value, h) => ({ label: hourLabel(h), value }))}
      />
      <Bars
        title="Tasks carried over, by week"
        labelHeading="Week of"
        valueLabel="Carried"
        bars={p.perWeek.map((w) => ({ label: w.week, value: w.carried }))}
      />
      <Bars
        title="Notifications sent, by week"
        labelHeading="Week of"
        valueLabel="Sent"
        bars={p.perWeek.map((w) => ({ label: w.week, value: w.notifications }))}
      />
      {p.slippingTopics.length > 0 && (
        <div>
          <h3 className="font-medium">Topics that slip</h3>
          <ul className="list-disc pl-5">
            {p.slippingTopics.map((t) => (
              <li key={t.topic}>
                {t.topic} <span className="text-fg-muted">({t.count})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.returningIdeas.length > 0 && (
        <div>
          <h3 className="font-medium">Ideas you keep coming back to</h3>
          <ul className="list-disc pl-5">
            {p.returningIdeas.map((t) => (
              <li key={t.title}>
                {t.title} <span className="text-fg-muted">({t.returns})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
