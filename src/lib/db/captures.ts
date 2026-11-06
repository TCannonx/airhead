import { queueFile } from '../files/upload';
import type { Capture } from '../schemas/records';
import type { AirheadDb } from './db';
import { newCapture, save } from './repository';

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
  const capture = newCapture(userId, {
    text: input.text?.trim() || null,
    url: input.url ?? null,
    kind: input.photo ? 'image' : input.url ? 'link' : 'text',
  });
  if (input.photo) {
    const file = await queueFile(db, userId, capture.id, input.photo);
    capture.payload = {
      ...capture.payload,
      files: [{ id: file.id, path: file.path, mime: file.mime, size: file.size }],
    };
  }
  return save(db, 'captures', capture);
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
