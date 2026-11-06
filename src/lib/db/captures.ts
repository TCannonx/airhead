import { queueFile } from '../files/upload';
import { analyseCapture } from '../rules';
import type { Capture, Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { newCapture, newItem, save } from './repository';

export interface CaptureInput {
  text?: string | null;
  url?: string | null;
  photo?: Blob | null;
}

export interface CaptureResult {
  capture: Capture;
  /** Event the free rules created: confident (status open) or a suggestion. */
  event: Item | null;
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
  const analysis = text ? analyseCapture(text, { now: options.now }) : null;
  const url = input.url ?? analysis?.url ?? null;
  const when = analysis?.when ?? null;
  const at = new Date().toISOString();

  const capture = newCapture(userId, {
    text,
    url,
    kind: input.photo ? 'image' : url ? 'link' : 'text',
    ...(when
      ? when.confident
        ? { status: 'sorted' as const, sorted_at: at }
        : { status: 'needs_review' as const }
      : {}),
  });
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
  return { capture: saved, event };
}

/** The status chip shown under a capture. */
export function captureChip(c: Capture): string {
  if (c.status === 'sorted') return 'Sorted';
  if (c.status === 'needs_review') return 'Needs a tap';
  if (c.status === 'failed') return "Couldn't sort";
  if (c.kind === 'link') return 'Reading list';
  return 'Sorting soon';
}

const URL_RE = /^https?:\/\/\S+$/i;
export const isUrl = (text: string) => URL_RE.test(text.trim());
