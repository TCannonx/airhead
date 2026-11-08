import { queueFile } from '../files/upload';
import { parseLeave } from '../leave/parse';
import { analyseCapture, DEFAULT_TIME_ZONE } from '../rules';
import type { AiAction, Capture, Item } from '../schemas/records';
import { chipFor } from './aiActions';
import type { AirheadDb } from './db';
import { matchRule, ruleItemFor } from './memory';
import { newCapture, newItem, save, update } from './repository';

export interface CaptureInput {
  text?: string | null;
  url?: string | null;
  photo?: Blob | null;
}

export interface CaptureResult {
  capture: Capture;
  /** Event the free rules created: confident (status open) or a suggestion. */
  event: Item | null;
  /** Item a learned rule sorted the capture into (instant, offline, no AI). */
  ruleItem: Item | null;
}

/**
 * Saves a capture locally first (never waits on the network), then applies the
 * free rules: a link becomes a reading item; a confident date becomes a
 * Personal event straight away (undoable); a fuzzy date becomes a suggestion.
 * Photos are kept on the device and queued for upload. The capture's own text
 * is never altered.
 */
export async function createCapture(
  db: AirheadDb,
  userId: string,
  input: CaptureInput,
  options: { now?: Date } = {},
): Promise<CaptureResult> {
  const text = input.text?.trim() || null;
  // "AL 14–18 July": a leave booking to propose, not an event (Task 4.6).
  const leave =
    text && !input.url ? parseLeave(text, options.now ?? new Date(), DEFAULT_TIME_ZONE) : null;
  const analysis = text ? analyseCapture(text, { now: options.now }) : null;
  const url = input.url ?? analysis?.url ?? null;
  const when = leave ? null : (analysis?.when ?? null);
  const at = new Date().toISOString();

  // Learned rules run after the free rules, before anything waits for AI.
  const rule =
    text && !url && !when && !leave && !input.photo
      ? matchRule(await db.learned_rules.toArray(), text)
      : undefined;

  const capture = newCapture(userId, {
    text,
    url,
    kind: input.photo ? 'image' : url ? 'link' : 'text',
    // A link is handled by the free rules (reading item), so it doesn't wait in the Inbox.
    ...(url ? { status: 'sorted' as const, sorted_at: at } : {}),
    ...(when
      ? when.confident
        ? { status: 'sorted' as const, sorted_at: at }
        : { status: 'needs_review' as const }
      : {}),
    ...(rule || leave ? { status: 'sorted' as const, sorted_at: at } : {}),
  });
  if (leave) capture.payload = { ...capture.payload, leave_proposal: leave };
  if (rule) capture.payload = { ...capture.payload, rule_id: rule.id };
  if (input.photo) {
    const file = await queueFile(db, userId, capture.id, input.photo);
    capture.payload = {
      ...capture.payload,
      files: [{ id: file.id, path: file.path, mime: file.mime, size: file.size }],
    };
  }
  const saved = await save(db, 'captures', capture);

  if (url) {
    await save(
      db,
      'items',
      newItem(userId, {
        type: 'reading',
        title: (analysis?.kind === 'link' && analysis.title) || url,
        capture_id: saved.id,
        data: { url },
      }),
    );
  }

  let event: Item | null = null;
  if (when && analysis) {
    event = await save(
      db,
      'items',
      newItem(userId, {
        type: 'event',
        title: analysis.title || text || 'Event',
        capture_id: saved.id,
        status: when.confident ? 'open' : 'suggested',
        calendar: 'personal',
        start_at: when.start,
        end_at: when.end,
        all_day: when.allDay,
        rrule: when.rrule,
      }),
    );
  }
  let ruleItem: Item | null = null;
  if (rule && text) {
    ruleItem = await save(db, 'items', ruleItemFor(rule, userId, saved.id, text));
    await update(db, 'learned_rules', rule.id, { hits: rule.hits + 1 });
  }
  return { capture: saved, event, ruleItem };
}

/** The status chip shown under a capture (what AI actions did comes first). */
export function captureChip(c: Capture, actions: AiAction[] = []): string {
  const acted = chipFor(actions.filter((a) => a.capture_id === c.id));
  if (acted) return acted;
  if (c.kind === 'link') return 'Reading list';
  if (c.payload.leave_booking_id) return 'Leave booked';
  if (c.payload.leave_proposal) return 'Leave to book (Today)';
  if (c.status === 'sorted' && typeof c.payload.rule_id === 'string')
    return 'Sorted (learned rule)';
  if (c.status === 'sorted') return 'Sorted';
  if (c.status === 'needs_review') return 'Needs a tap';
  if (c.status === 'failed') return "Couldn't sort";
  return 'Sorting soon';
}

const URL_RE = /^https?:\/\/\S+$/i;
export const isUrl = (text: string) => URL_RE.test(text.trim());
