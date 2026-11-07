import { TZDate } from '@date-fns/tz';
import { format, subMonths } from 'date-fns';
import type { Capture, Correction, Item } from '../schemas/records';
import type { UsageRow } from './usage';

export const WINDOW_DAYS = 30;

export interface SuccessMeasures {
  capturesPerDay: number;
  /** corrections ÷ items sorted from captures, last 30 days (0 when nothing was sorted). */
  correctionRate: number;
  corrections: number;
  itemsSorted: number;
}

/** The design doc's success measures, computed on the device from synced data. */
export function successMeasures(
  data: { captures: Capture[]; items: Item[]; corrections: Correction[] },
  now = new Date(),
): SuccessMeasures {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const recent = (iso: string) => Date.parse(iso) >= since;

  const captures = data.captures.filter((c) => !c.deleted_at && recent(c.captured_at)).length;
  const itemsSorted = data.items.filter((i) => i.capture_id && recent(i.created_at)).length;
  const corrections = data.corrections.filter((c) => !c.deleted_at && recent(c.created_at)).length;
  return {
    capturesPerDay: captures / WINDOW_DAYS,
    correctionRate: itemsSorted ? corrections / itemsSorted : 0,
    corrections,
    itemsSorted,
  };
}

/** AI cost for each of the last `months` calendar months (oldest first, empty months included). */
export function monthlyCosts(
  rows: UsageRow[],
  now: Date,
  timeZone: string,
  months = 3,
): { month: string; cost: number }[] {
  const current = new TZDate(now, timeZone);
  const keys = Array.from({ length: months }, (_, i) =>
    format(subMonths(current, months - 1 - i), 'yyyy-MM'),
  );
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const key = format(new TZDate(r.created_at, timeZone), 'yyyy-MM');
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Number(r.cost_eur));
  }
  return keys.map((month) => ({ month, cost: Math.round((totals.get(month) ?? 0) * 1e6) / 1e6 }));
}
