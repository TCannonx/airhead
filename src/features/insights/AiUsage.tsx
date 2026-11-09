import { TZDate } from '@date-fns/tz';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { euro, summariseUsage, type PriceRow, type UsageRow } from '../../lib/ai/usage';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { DEFAULT_TIME_ZONE } from '../../lib/rules';
import DailyBars from './DailyBars';
import { Button } from '../../ui/Button';

const TASK_LABELS: Record<string, string> = {
  sort_batch: 'Sorting',
  read_link: 'Link reading',
  morning_brief: 'Morning brief',
  weekly_review: 'Weekly review',
};
const PRICE_FIELDS = [
  ['input_per_mtok', 'input'],
  ['output_per_mtok', 'output'],
  ['cache_read_per_mtok', 'cache read'],
  ['cache_write_per_mtok', 'cache write'],
  ['eur_rate', '€ per $'],
] as const;

const cell =
  'w-20 rounded border border-border bg-surface px-1.5 py-1 text-right text-footnote tabular-nums  ';

function PriceTable({
  prices,
  onSave,
}: {
  prices: PriceRow[];
  onSave: (p: PriceRow) => Promise<void>;
}) {
  // The user's own row wins over the default for the same model.
  const byModel = new Map<string, PriceRow>();
  for (const p of prices) if (!byModel.has(p.model) || p.user_id) byModel.set(p.model, p);
  const [edits, setEdits] = useState<Record<string, PriceRow>>({});
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <table aria-label="Prices" className="w-full text-footnote">
      <thead>
        <tr className="text-left text-caption text-fg-muted">
          <th className="py-1 font-medium">Model</th>
          {PRICE_FIELDS.map(([, label]) => (
            <th key={label} className="py-1 text-right font-medium">
              {label}
            </th>
          ))}
          <th />
        </tr>
      </thead>
      <tbody>
        {[...byModel.values()].map((p) => {
          const row = edits[p.model] ?? p;
          return (
            <tr key={p.model} className="border-t border-border/60">
              <td className="py-1.5 pr-2">
                {p.model}
                {p.user_id && <span className="ml-1 text-caption text-fg-muted">(yours)</span>}
              </td>
              {PRICE_FIELDS.map(([key, label]) => (
                <td key={key} className="py-1.5 text-right">
                  <input
                    aria-label={`${p.model} ${label}${key === 'eur_rate' ? '' : ' $ per million tokens'}`}
                    inputMode="decimal"
                    className={cell}
                    value={String(row[key])}
                    onChange={(e) =>
                      setEdits((all) => ({
                        ...all,
                        [p.model]: { ...row, [key]: e.target.value as unknown as number },
                      }))
                    }
                  />
                </td>
              ))}
              <td className="py-1.5 pl-2 text-right">
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={`Save ${p.model}`}
                  onClick={async () => {
                    const values = Object.fromEntries(
                      PRICE_FIELDS.map(([k]) => [k, Number(row[k])]),
                    ) as Pick<PriceRow, (typeof PRICE_FIELDS)[number][0]>;
                    await onSave({ ...p, ...values });
                    setSaved(p.model);
                  }}
                >
                  Save
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
      {saved && (
        <caption className="caption-bottom pt-2 text-left text-caption text-fg-muted">
          Saved your price for {saved}.
        </caption>
      )}
    </table>
  );
}

/** Insights → AI usage (online: the usage log lives on the server). */
export default function AiUsage() {
  const { services, user } = useAuth();
  const db = useDb();
  const usage = services.usage;
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const settings = useLiveQuery(() => db.settings.get(user?.id ?? ''), [db, user?.id]);
  const timeZone = (settings?.data.time_zone as string | undefined) ?? DEFAULT_TIME_ZONE;
  const cap = settings?.data.ai_monthly_cap_eur;

  useEffect(() => {
    if (!usage) return;
    let alive = true;
    const local = new TZDate(new Date(), timeZone);
    const since = new TZDate(local.getFullYear(), local.getMonth(), 1, timeZone).toISOString();
    Promise.all([usage.monthRows(since), usage.prices()]).then(
      ([r, p]) => {
        if (!alive) return;
        setRows(r);
        setPrices(p);
      },
      () => alive && setError('AI usage couldn’t be loaded. Check your connection and try again.'),
    );
    return () => {
      alive = false;
    };
  }, [usage, timeZone]);

  if (!usage) {
    return (
      <p className="text-footnote text-fg-muted">
        AI usage shows here once Airhead is connected to its server.
      </p>
    );
  }
  if (error) return <p className="text-footnote text-fg-muted">{error}</p>;
  if (!rows) return <p className="text-footnote text-fg-muted">Loading…</p>;

  const s = summariseUsage(rows, new Date(), timeZone);
  const capValue = capDraft ?? (typeof cap === 'number' ? String(cap) : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-8">
        <div>
          <p className="text-caption text-fg-muted">This month so far</p>
          <p className="text-3xl font-semibold tabular-nums">{euro(s.monthToDate)}</p>
          <p className="text-caption text-fg-muted">{s.calls} AI calls</p>
        </div>
        <div>
          <p className="text-caption text-fg-muted">Projected by month-end</p>
          <p className="text-xl font-medium tabular-nums">{euro(s.projected)}</p>
        </div>
        {typeof cap === 'number' && cap > 0 && (
          <div>
            <p className="text-caption text-fg-muted">Monthly limit</p>
            <p className="text-xl font-medium tabular-nums">{euro(cap)}</p>
          </div>
        )}
      </div>

      <DailyBars days={s.daily} title="Daily AI spend" />

      <table aria-label="By task" className="w-full text-footnote">
        <thead>
          <tr className="text-left text-caption text-fg-muted">
            <th className="py-1 font-medium">Task</th>
            <th className="py-1 text-right font-medium">Calls</th>
            <th className="py-1 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {s.byTask.map((t) => (
            <tr key={t.task} className="border-t border-border/60">
              <td className="py-1">{TASK_LABELS[t.task] ?? t.task}</td>
              <td className="py-1 text-right tabular-nums">{t.calls}</td>
              <td className="py-1 text-right tabular-nums">{euro(t.cost)}</td>
            </tr>
          ))}
          {s.byTask.length === 0 && (
            <tr>
              <td colSpan={3} className="py-1 text-fg-muted">
                No AI calls this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(capValue);
          void updateSettingsData(db, user?.id ?? '', {
            ai_monthly_cap_eur: Number.isFinite(value) && value > 0 ? value : null,
          });
          setCapDraft(null);
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-fg-muted">
          Monthly limit (€)
          <input
            inputMode="decimal"
            className={cell}
            value={capValue}
            placeholder="none"
            onChange={(e) => setCapDraft(e.target.value)}
          />
        </label>
        <Button size="sm" type="submit">
          Save limit
        </Button>
        <p className="w-full text-caption text-fg-muted">
          At the limit, background sorting pauses (captures still save); on-demand AI says so. Empty
          or 0 = no limit.
        </p>
      </form>

      <div>
        <h3 className="mb-1 text-footnote font-medium text-fg-muted">
          Prices (US$ per million tokens)
        </h3>
        <PriceTable
          prices={prices}
          onSave={async (p) => {
            const { id: _id, user_id: _u, ...rest } = p;
            await usage.savePrice(rest);
            setPrices(await usage.prices());
          }}
        />
      </div>

      <p className="text-caption text-fg-muted">
        These figures are estimates from token counts and the prices above. The Claude Console is
        the true record of what you are billed.
      </p>
    </div>
  );
}
