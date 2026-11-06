import { queueFile } from '../files/upload';
import { analyseCapture } from '../rules';
import type { Capture } from '../schemas/records';
import type { AirheadDb } from './db';
import { newCapture, newItem, save } from './repository';

export interface CaptureInput {
  text?: string | null;
  url?: string | null;
  photo?: Blob | null;
}

/**
 * Saves a capture locally first (never waits on the network). A photo is kept
 * on the device and queued for upload; its Storage path is recorded on the capture.
 */
export async function createCapture(
  db: AirheadDb,
  userId: string,
  input: CaptureInput,
): Promise<Capture> {
  const text = input.text?.trim() || null;
  // Free rules run instantly on the device; the capture itself is never altered.
  const analysis = text ? analyseCapture(text) : null;
  const url = input.url ?? analysis?.url ?? null;
  const capture = newCapture(userId, {
    text,
    url,
    kind: input.photo ? 'image' : url ? 'link' : 'text',
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
  return saved;
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
