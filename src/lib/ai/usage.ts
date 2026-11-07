import { TZDate } from '@date-fns/tz';
import { format, getDaysInMonth } from 'date-fns';

/** A row of the ai_usage_mine view. */
export interface UsageRow {
  task: string;
  tier: 'small' | 'large';
  model: string;
  cost_eur: number;
  ok: boolean;
  error_code: string | null;
  created_at: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

/** A row of ai_prices (US dollars per million tokens; eur_rate = euros per dollar). */
export interface PriceRow {
  id: string;
  user_id: string | null;
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
  eur_rate: number;
}

export interface UsageSummary {
  monthToDate: number;
  projected: number;
  calls: number;
  byTask: { task: string; cost: number; calls: number }[];
  daily: { date: string; cost: number }[];
}

/** Month-to-date AI spend by the calendar month in the user's time zone. */
export function summariseUsage(rows: UsageRow[], now: Date, timeZone: string): UsageSummary {
  const today = new TZDate(now, timeZone);
  const month = format(today, 'yyyy-MM');
  const inMonth = rows.filter(
    (r) => format(new TZDate(r.created_at, timeZone), 'yyyy-MM') === month,
  );

  const byTask = new Map<string, { task: string; cost: number; calls: number }>();
  const byDay = new Map<string, number>();
  let total = 0;
  for (const r of inMonth) {
    const cost = Number(r.cost_eur) || 0;
    total += cost;
    const t = byTask.get(r.task) ?? { task: r.task, cost: 0, calls: 0 };
    t.cost += cost;
    t.calls += 1;
    byTask.set(r.task, t);
    const day = format(new TZDate(r.created_at, timeZone), 'yyyy-MM-dd');
    byDay.set(day, (byDay.get(day) ?? 0) + cost);
  }

  const elapsed = today.getDate();
  const daily = Array.from({ length: elapsed }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date, cost: byDay.get(date) ?? 0 };
  });
  return {
    monthToDate: total,
    projected: elapsed ? (total / elapsed) * getDaysInMonth(today) : 0,
    calls: inMonth.length,
    byTask: [...byTask.values()].sort((a, b) => b.cost - a.cost),
    daily,
  };
}

/** Estimate for an on-demand button: average of the last 10 successful calls of that task. */
export function estimateCost(rows: UsageRow[], task: string, fallback: number): number {
  const recent = rows
    .filter((r) => r.task === task && r.ok)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);
  if (recent.length === 0) return fallback;
  return recent.reduce((sum, r) => sum + Number(r.cost_eur), 0) / recent.length;
}

export const euro = (n: number) =>
  n < 0.01 && n > 0
    ? `€${n.toFixed(4)}`
    : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);
