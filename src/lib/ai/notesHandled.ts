import { buildReceipt } from '../db/receipts';
import type { AiAction, Capture, Correction, FollowUp, Item } from '../schemas/records';
import { successMeasures, WINDOW_DAYS } from './measures';

/**
 * Trust in numbers (Task 12.5): how the last 30 days of captures were handled.
 * Every capture is either waiting for sorting, acted on (an item, action,
 * question or Workshop note), or "not acted on": kept as written, or sorting
 * failed. The not-acted-on ones are listed so the person can open them.
 */
export interface NotesHandled {
  total: number;
  /** Acted on: their receipt has at least one outcome. */
  handled: number;
  waiting: number;
  notActedOn: Capture[];
  questions: { open: number; answered: number; dismissed: number };
  correctionRate: number;
  corrections: number;
  itemsSorted: number;
}

export function notesHandled(
  data: {
    captures: Capture[];
    items: Item[];
    actions: AiAction[];
    followUps: FollowUp[];
    corrections: Correction[];
  },
  now = new Date(),
): NotesHandled {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const recent = (iso: string) => Date.parse(iso) >= since;
  const byCapture = <T extends { capture_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows)
      if (r.capture_id) m.set(r.capture_id, [...(m.get(r.capture_id) ?? []), r]);
    return m;
  };
  const items = byCapture(data.items);
  const actions = byCapture(data.actions);
  const followUps = byCapture(data.followUps);

  const captures = data.captures.filter((c) => !c.deleted_at && recent(c.captured_at));
  let handled = 0;
  let waiting = 0;
  const notActedOn: Capture[] = [];
  for (const c of captures) {
    if (c.status === 'failed') {
      notActedOn.push(c);
      continue;
    }
    const r = buildReceipt(
      c,
      {
        items: items.get(c.id) ?? [],
        actions: actions.get(c.id) ?? [],
        followUps: followUps.get(c.id) ?? [],
      },
      now,
    );
    if (r.state === 'waiting') waiting++;
    else if (r.lines.every((l) => l.kind === 'kept' && !l.to)) notActedOn.push(c);
    else handled++;
  }
  const qs = data.followUps.filter((f) => !f.deleted_at && recent(f.created_at));
  const m = successMeasures(
    { captures: data.captures, items: data.items, corrections: data.corrections },
    now,
  );
  return {
    total: captures.length,
    handled,
    waiting,
    notActedOn: notActedOn.sort((a, b) => b.captured_at.localeCompare(a.captured_at)),
    questions: {
      open: qs.filter((f) => f.status === 'open').length,
      answered: qs.filter((f) => f.status === 'answered').length,
      dismissed: qs.filter((f) => f.status === 'dismissed').length,
    },
    correctionRate: m.correctionRate,
    corrections: m.corrections,
    itemsSorted: m.itemsSorted,
  };
}
