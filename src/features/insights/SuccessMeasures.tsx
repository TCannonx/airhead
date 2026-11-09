import { TZDate } from '@date-fns/tz';
import { format, subMonths } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { monthlyCosts, successMeasures, WINDOW_DAYS } from '../../lib/ai/measures';
import { euro, type UsageRow } from '../../lib/ai/usage';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { DEFAULT_TIME_ZONE } from '../../lib/rules';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-border/60 bg-surface p-4">
      <p className="text-caption text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-caption text-fg-muted">{note}</p>}
    </div>
  );
}

/** The design doc's three success measures (Task 3.8). */
export default function SuccessMeasures() {
  const db = useDb();
  const { services } = useAuth();
  const usage = services.usage;
  const data = useLiveQuery(
    async () => ({
      captures: await db.captures.toArray(),
      items: await db.items.toArray(),
      corrections: await db.corrections.toArray(),
    }),
    [db],
  );
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    if (!usage) return;
    let alive = true;
    const start = subMonths(new TZDate(new Date(), DEFAULT_TIME_ZONE), 2);
    const since = new TZDate(start.getFullYear(), start.getMonth(), 1, DEFAULT_TIME_ZONE);
    usage.monthRows(since.toISOString()).then(
      (r) => alive && setRows(r),
      () => alive && setRows([]),
    );
    return () => {
      alive = false;
    };
  }, [usage]);

  if (!data) return null;
  const m = successMeasures(data);
  const costs = rows ? monthlyCosts(rows, new Date(), DEFAULT_TIME_ZONE, 3) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        label={`Captures per day (last ${WINDOW_DAYS} days)`}
        value={m.capturesPerDay.toFixed(1)}
      />
      <Tile
        label="Sorting correction rate"
        value={`${Math.round(m.correctionRate * 100)}%`}
        note={`${m.corrections} of ${m.itemsSorted} sorted items corrected. A rising rate means sorting needs tuning.`}
      />
      <div className="rounded-card border border-border/60 bg-surface p-4">
        <p className="text-caption text-fg-muted">AI cost per month</p>
        {costs ? (
          <ul aria-label="AI cost per month" className="mt-1 space-y-0.5 text-footnote">
            {costs.map((c) => (
              <li key={c.month} className="flex justify-between tabular-nums">
                <span>{format(new Date(`${c.month}-15T12:00:00Z`), 'MMM yyyy')}</span>
                <span>{euro(c.cost)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-footnote text-fg-muted">
            {usage ? 'Loading…' : 'Shown once connected to the server.'}
          </p>
        )}
      </div>
    </div>
  );
}
