import { queueFile } from '../files/upload';
import { parseLeave } from '../leave/parse';
import { analyseCapture, DEFAULT_TIME_ZONE } from '../rules';
import { findUrls, normaliseUrl, withoutUrls } from '../rules/links';
import type { AiAction, Capture, Item } from '../schemas/records';
import { chipFor } from './aiActions';
import type { AirheadDb } from './db';
import { matchRule, ruleItemFor } from './memory';
import { newCapture, newItem, save, update } from './repository';

/**
 * Notes that change something already there ("dentist moved to Thursday 4pm")
 * or talk about time off ("off 22-24 Dec", "9.5 days annual leave left") are
 * left for AI sorting, which can move the existing item or book the leave
 * (Phase 10). The instant date rule would otherwise make a new event from the
 * date in them and the AI would never see the note.
 */
export const FOR_AI =
  /\b(?:remind me|moved|move it|reschedul\w*|postpon\w*|pushed (?:back|out|to)|brought forward|annual leave|on leave|days? off|off sick|sick (?:day|leave))\b|^\s*(?:off|took|taking|on holiday)\b|\b(?:day|morning|afternoon) off\b|\boff\s*$/i;

/** Words that ask for more than the event itself ("need a reminder to", "still need to plan"). */
const INSTRUCTION =
  /\b(?:need|needs|needed|remind|reminder|still|then|also|must|should|don'?t forget|to ?do|placeholder|plan)\b/i;

/**
 * A simple note ("dentist Tue 3pm", "Quiz every Thursday 8pm-12pm"): one
 * sentence of at most 8 words with no instruction words. Its instant event is
 * all there is to it, so the capture is done. Anything longer keeps its
 * instant event but still goes to AI sorting, which tidies the event and adds
 * what else the note asks for (Task 11.1).
 */
export function isSimpleCapture(text: string): boolean {
  const sentences = text
    .split(/[.!?;]+(?:\s+|$)|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  return sentences.length <= 1 && words.length <= 8 && !INSTRUCTION.test(text);
}

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
  // Every distinct link becomes a reading item (Task 16.1); the other words of a
  // longer note still wait for sorting, as written.
  const urls = input.url ? [input.url] : text ? findUrls(text).map((f) => f.url) : [];
  const otherWords = text ? withoutUrls(text) : '';
  const linkOnly = urls.length > 0 && (input.url ? true : otherWords.split(' ').filter(Boolean).length <= 3);
  const when = leave || (text && FOR_AI.test(text)) ? null : (analysis?.when ?? null);
  const at = new Date().toISOString();

  // Learned rules run after the free rules, before anything waits for AI.
  const rule =
    text && !url && !when && !leave && !input.photo
      ? matchRule(await db.learned_rules.toArray(), text)
      : undefined;

  // A longer note keeps its instant event but waits for sorting to tidy it.
  const tidyLater = !!when && !!text && !isSimpleCapture(text);

  const capture = newCapture(userId, {
    text,
    url,
    kind: input.photo ? 'image' : url ? 'link' : 'text',
    // A link on its own is handled by the free rules (reading item), so it doesn't wait in the Inbox.
    ...(url && linkOnly ? { status: 'sorted' as const, sorted_at: at } : {}),
    ...(when
      ? when.confident
        ? { status: 'sorted' as const, sorted_at: at }
        : { status: 'needs_review' as const }
      : {}),
    ...(rule || leave ? { status: 'sorted' as const, sorted_at: at } : {}),
    ...(tidyLater ? { status: 'unsorted' as const, sorted_at: null } : {}),
  });
  if (leave) capture.payload = { ...capture.payload, leave_proposal: leave };
  if (rule) capture.payload = { ...capture.payload, rule_id: rule.id };
  const instant =
    when && analysis
      ? newItem(userId, {
          type: 'event',
          title: analysis.title || text || 'Event',
          capture_id: capture.id,
          status: when.confident ? 'open' : 'suggested',
          calendar: 'personal',
          start_at: when.start,
          end_at: when.end,
          all_day: when.allDay,
          rrule: when.rrule,
        })
      : null;
  if (instant && tidyLater) capture.payload = { ...capture.payload, instant_item_id: instant.id };
  if (input.photo) {
    const file = await queueFile(db, userId, capture.id, input.photo);
    capture.payload = {
      ...capture.payload,
      files: [{ id: file.id, path: file.path, mime: file.mime, size: file.size }],
    };
  }
  const saved = await save(db, 'captures', capture);

  if (urls.length) {
    const reading = await db.items
      .where('type')
      .equals('reading')
      .filter((i) => !i.deleted_at && typeof i.data.url === 'string')
      .toArray();
    const byKey = new Map(reading.map((i) => [normaliseUrl(String(i.data.url)), i]));
    for (const link of urls) {
      const same = byKey.get(normaliseUrl(link));
      if (same) {
        // Saved again: join the existing item and record this capture too.
        const caps = Array.isArray(same.data.captures) ? (same.data.captures as string[]) : [];
        if (!caps.includes(saved.id))
          await update(db, 'items', same.id, {
            data: { ...same.data, captures: [...caps, saved.id] },
          });
        continue;
      }
      const item = await save(
        db,
        'items',
        newItem(userId, {
          type: 'reading',
          title: urls.length === 1 ? (analysis?.kind === 'link' && analysis.title) || link : link,
          capture_id: saved.id,
          data: { url: link, captures: [saved.id] },
        }),
      );
      byKey.set(normaliseUrl(link), item);
    }
  }

  const event: Item | null = instant ? await save(db, 'items', instant) : null;
  let ruleItem: Item | null = null;
  if (rule && text) {
    ruleItem = await save(db, 'items', ruleItemFor(rule, userId, saved.id, text));
    await update(db, 'learned_rules', rule.id, { hits: rule.hits + 1 });
  }
  return { capture: saved, event, ruleItem };
}

export const WORKSHOP_CHIP = 'Sent to Workshop';

/**
 * Adds "Sent to Workshop" to a chip when the capture (or the words sorting
 * could not place) went to the Workshop (Task 11.2). A capture sent whole shows
 * only that; one whose leftover went shows what else sorting did first.
 */
export function withWorkshop(c: Capture, chip: string): string {
  if (typeof c.payload.workshop_item_id !== 'string') return chip;
  return c.payload.workshop_reason === 'leftover' ? `${chip} · ${WORKSHOP_CHIP}` : WORKSHOP_CHIP;
}

/** The status chip shown under a capture (what AI actions did comes first). */
export function captureChip(c: Capture, actions: AiAction[] = []): string {
  return withWorkshop(c, baseChip(c, actions));
}

function baseChip(c: Capture, actions: AiAction[]): string {
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
