import type { AiAction, Capture, FollowUp, Item } from '../schemas/records';
import { TYPE_LABELS } from './sorting';

/**
 * "What Airhead did" with a capture (Task 12.3): one line per outcome, each
 * with the words it came from, so nothing a note says is handled silently.
 * Built on the device from the items, AI actions and questions that carry the
 * capture's id.
 */
export type ReceiptLine =
  | { kind: 'item'; text: string; quote: string | null; to: string }
  | { kind: 'workshop'; text: string; quote: string | null; to: string }
  | { kind: 'applied'; text: string; quote: string | null; action: AiAction }
  | { kind: 'proposed'; text: string; quote: string | null }
  | { kind: 'undone'; text: string; quote: string | null }
  | { kind: 'question'; text: string; quote: string | null }
  | { kind: 'kept'; text: string; quote: string | null; to?: string };

export type Receipt = { state: 'waiting'; text: string } | { state: 'done'; lines: ReceiptLine[] };

/** Sorting checks every 5 minutes, once the newest capture has settled for 2. */
const CHECK_EVERY_MS = 5 * 60_000;
const SETTLE_MS = 2 * 60_000;

/** When the 5-minute check will pick this capture up: the first check after it settles. */
export function nextCheck(capturedAt: string, now: Date): Date {
  const earliest = Math.max(Date.parse(capturedAt) + SETTLE_MS, now.getTime());
  return new Date(Math.ceil(earliest / CHECK_EVERY_MS) * CHECK_EVERY_MS);
}

const hhmm = (d: Date) =>
  d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const typeWord = (i: Item) =>
  i.type === 'list_entry' ? 'list entry' : TYPE_LABELS[i.type].toLowerCase();

const quoteOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function buildReceipt(
  capture: Capture,
  rows: { items: Item[]; actions: AiAction[]; followUps: FollowUp[] },
  now = new Date(),
): Receipt {
  if (capture.status === 'unsorted' && !capture.deleted_at) {
    // A link's reading item is made at once; it is waiting only for the summary.
    return {
      state: 'waiting',
      text: `Waiting for AI sorting (next check by ${hhmm(nextCheck(capture.captured_at, now))})`,
    };
  }
  const lines: ReceiptLine[] = [];
  const items = rows.items
    .filter((i) => i.capture_id === capture.id && !i.deleted_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const i of items) {
    if (i.data.workshop === true && typeof i.data.workshop_from === 'string') {
      lines.push({
        kind: 'workshop',
        text: `Sent to the Workshop: ${i.title}`,
        quote: i.data.workshop_from === 'leftover' ? i.title : capture.text,
        to: `/workshop/${i.id}`,
      });
    } else if (i.type === 'note' && !i.data.workshop) {
      lines.push({
        kind: 'kept',
        text: `Kept as a note: ${i.title}`,
        quote: quoteOf(i.data.quote),
        to: `/library/item/${i.id}`,
      });
    } else {
      const status = i.status === 'suggested' ? ' (needs a tap)' : '';
      const steps = Array.isArray(i.data.steps) ? ` with ${i.data.steps.length} steps` : '';
      lines.push({
        kind: 'item',
        text: `Made ${/^[aeiou]/.test(typeWord(i)) ? 'an' : 'a'} ${typeWord(i)}${steps}: ${i.title}${status}`,
        quote: quoteOf(i.data.quote),
        to: `/library/item/${i.id}`,
      });
    }
  }
  for (const a of rows.actions
    .filter((x) => x.capture_id === capture.id && !x.deleted_at)
    .sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const quote = quoteOf(a.quote);
    if (a.status === 'applied') lines.push({ kind: 'applied', text: a.summary, quote, action: a });
    else if (a.status === 'proposed')
      lines.push({ kind: 'proposed', text: `Asks your OK: ${a.summary}`, quote });
    else if (a.status === 'undone' || a.status === 'dismissed')
      lines.push({
        kind: 'undone',
        text: `${a.status === 'undone' ? 'Undone' : 'Dismissed'}: ${a.summary}`,
        quote,
      });
  }
  for (const f of rows.followUps
    .filter((x) => x.capture_id === capture.id && !x.deleted_at)
    .sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const after =
      f.status === 'answered'
        ? ` You said: ${f.answer ?? ''}`
        : f.status === 'dismissed'
          ? ' (dismissed)'
          : '';
    lines.push({ kind: 'question', text: `Asked: ${f.question}${after}`, quote: null });
  }
  // Nothing at all came of it: say so, never silently.
  if (!lines.length) {
    const words = (capture.text ?? capture.url ?? '').trim();
    lines.push({
      kind: 'kept',
      text: words ? `Kept as written, not acted on: “${words}”` : 'Kept as written, not acted on',
      quote: null,
    });
  }
  return { state: 'done', lines };
}
