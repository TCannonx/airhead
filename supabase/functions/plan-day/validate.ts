import { localInstant, PREPARE_MIN_LEAD } from '../_shared/plan/defaults.ts';
import type { PlanResultT } from '../_shared/schemas/plan.ts';
import { inQuietHours, localNow, readNotif } from '../scheduler-tick/notif.ts';
import type { PlanDigest } from './digest.ts';

/** What apply_plan writes (Task 13.6). */
export interface ApplyPayload {
  items: {
    item_id: string;
    surface_at: string | null;
    effort_minutes: number | null;
    needs: string[];
    prep: string[];
    reason: string;
    confidence: number;
  }[];
  nudges: {
    key: string;
    kind: string;
    item_id: string;
    send_at: string;
    title: string;
    body: string;
    url: string;
    reason: string;
    delivery: 'push' | 'digest';
  }[];
  /** Occurrences the plan covered: earlier AI nudges for them that it no longer contains are cancelled. */
  occurrences: { item_id: string; date: string }[];
}

export interface Dropped {
  item_id: string;
  kind?: string;
  why: string;
}

const MAX_PER_OCCURRENCE = 3;
const WALL = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/;

function wallToInstant(s: string, tz: string): Date | null {
  const m = WALL.exec(s.trim());
  return m ? localInstant(m[1] as string, `${m[2]}:${m[3]}`, tz) : null;
}

/**
 * Checks the model's plan against the digest and the hard rules (spec §3.2):
 * unknown items, past times, prepare inside 45 minutes of the start, pushes in
 * quiet hours (except leave and do), more than 3 nudges per occurrence, and the
 * daily nudge cap. Reading and an undated follow-up always go to the digest.
 */
export function validatePlan(
  result: PlanResultT,
  digest: PlanDigest,
  settings: Record<string, unknown>,
  now: Date,
): { payload: ApplyPayload; dropped: Dropped[] } {
  const tz = digest.time_zone;
  const notif = readNotif(settings);
  const dropped: Dropped[] = [];
  const payload: ApplyPayload = { items: [], nudges: [], occurrences: [] };
  const plannable = new Map(
    digest.items
      .filter((i) => i.kind !== 'linked')
      .map((i) => [`${i.item_id}|${i.occurrence_date}`, i]),
  );
  const seenItems = new Set<string>();
  const seenOcc = new Set<string>();

  for (const r of result.items) {
    const occ = plannable.get(`${r.item_id}|${r.occurrence_date}`);
    if (!occ) {
      dropped.push({ item_id: r.item_id, why: 'not in the digest' });
      continue;
    }
    if (!seenOcc.has(`${r.item_id}|${r.occurrence_date}`)) {
      seenOcc.add(`${r.item_id}|${r.occurrence_date}`);
      payload.occurrences.push({ item_id: r.item_id, date: r.occurrence_date });
    }
    if (!seenItems.has(r.item_id)) {
      seenItems.add(r.item_id);
      const surface = r.surface_at ? wallToInstant(r.surface_at, tz) : null;
      payload.items.push({
        item_id: r.item_id,
        surface_at: surface ? surface.toISOString() : null,
        effort_minutes: r.effort_minutes > 0 ? Math.min(Math.round(r.effort_minutes), 10080) : null,
        needs: r.needs.map((x) => x.slice(0, 80)).slice(0, 5),
        prep: r.prep.map((x) => x.slice(0, 120)).slice(0, 5),
        reason: r.reason.slice(0, 200),
        confidence: Math.min(1, Math.max(0, r.confidence)),
      });
    }

    const start = occ.at ? Date.parse(occ.at) : null;
    const kept: ApplyPayload['nudges'] = [];
    const kinds = new Set<string>();
    for (const n of r.nudges) {
      const at = wallToInstant(n.at, tz);
      const drop = (why: string) => dropped.push({ item_id: r.item_id, kind: n.kind, why });
      if (!at) {
        drop('unreadable time');
        continue;
      }
      if (at.getTime() <= now.getTime()) {
        drop('in the past');
        continue;
      }
      if (
        n.kind === 'prepare' &&
        start !== null &&
        at.getTime() > start - PREPARE_MIN_LEAD * 60_000
      ) {
        drop('prepare inside 45 minutes of the start');
        continue;
      }
      const delivery =
        n.kind === 'reading' || (n.kind === 'follow_up' && occ.kind !== 'task')
          ? 'digest'
          : n.delivery;
      if (
        delivery === 'push' &&
        n.kind !== 'leave' &&
        n.kind !== 'do' &&
        inQuietHours(localNow(at, tz).hhmm, notif)
      ) {
        drop('push in quiet hours');
        continue;
      }
      if (kinds.has(n.kind)) {
        drop('a second nudge of the same kind');
        continue;
      }
      if (kept.length >= MAX_PER_OCCURRENCE) {
        drop('more than 3 nudges for one occurrence');
        continue;
      }
      kinds.add(n.kind);
      kept.push({
        key: `plan:${n.kind}:${r.item_id}:${r.occurrence_date}`,
        kind: n.kind,
        item_id: r.item_id,
        send_at: at.toISOString(),
        title: n.title.slice(0, 120),
        body: n.body.slice(0, 240),
        url: `/library/item/${r.item_id}`,
        reason: n.reason.slice(0, 200),
        delivery,
      });
    }
    payload.nudges.push(...kept);
  }

  // The daily cap on pushes, per local day: the earliest are kept.
  payload.nudges.sort((a, b) => a.send_at.localeCompare(b.send_at));
  const perDay = new Map<string, number>();
  payload.nudges = payload.nudges.filter((n) => {
    if (n.delivery !== 'push') return true;
    const day = localNow(new Date(n.send_at), tz).date;
    const count = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, count);
    if (count > notif.daily_cap) {
      dropped.push({ item_id: n.item_id, kind: n.kind, why: 'over the daily nudge cap' });
      return false;
    }
    return true;
  });
  return { payload, dropped };
}
