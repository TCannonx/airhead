/**
 * ingest-capture (Task 7.2): an iOS Shortcut posts a capture with its capture
 * token. The capture is saved exactly as sent, Unsorted, for the usual sorting
 * to pick up; nothing in it is acted on here (data, never instructions).
 * Replies are plain text, for the Shortcut to show.
 */
export const MAX_TEXT = 20_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export interface IngestBody {
  text?: unknown;
  url?: unknown;
  image?: unknown;
  image_type?: unknown;
}

export interface CaptureRow {
  id: string;
  user_id: string;
  kind: 'text' | 'link' | 'image';
  text: string | null;
  url: string | null;
  payload: Record<string, unknown>;
  source: 'shortcut';
  status: 'unsorted';
  captured_at: string;
}

export interface IngestDeps {
  /** use_capture_token(hash): null when unknown or revoked. */
  lookup(hash: string): Promise<{ user_id: string; allowed: boolean } | null>;
  insert(row: CaptureRow): Promise<void>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  now?: () => Date;
  uuid?: () => string;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const URL_ONLY = /^https?:\/\/\S+$/i;

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function runIngest(
  token: string,
  body: IngestBody,
  deps: IngestDeps,
): Promise<{ status: number; message: string }> {
  if (!token)
    return { status: 401, message: 'Missing capture token. Set it up in Airhead → Settings.' };
  const found = await deps.lookup(await sha256Hex(token));
  if (!found)
    return {
      status: 401,
      message: 'This capture token was revoked or is wrong. Make a new one in Airhead → Settings.',
    };
  if (!found.allowed)
    return { status: 429, message: 'Too many captures this hour. Try again later.' };

  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  if (rawText.length > MAX_TEXT)
    return { status: 413, message: 'That text is too long to capture.' };
  let url = typeof body.url === 'string' && URL_ONLY.test(body.url.trim()) ? body.url.trim() : null;
  let text: string | null = rawText || null;
  // A share of just a link arrives as text.
  if (!url && text && URL_ONLY.test(text)) {
    url = text;
    text = null;
  }

  const id = (deps.uuid ?? (() => crypto.randomUUID()))();
  const payload: Record<string, unknown> = {};
  let kind: CaptureRow['kind'] = url ? 'link' : 'text';
  if (typeof body.image === 'string' && body.image) {
    const mime = typeof body.image_type === 'string' ? body.image_type : 'image/jpeg';
    const ext = IMAGE_TYPES[mime];
    if (!ext)
      return { status: 415, message: 'Only JPEG, PNG, WebP or HEIC photos can be captured.' };
    const bytes = decodeBase64(body.image);
    if (!bytes || bytes.length === 0)
      return { status: 400, message: 'The photo could not be read.' };
    if (bytes.length > MAX_IMAGE_BYTES)
      return { status: 413, message: 'That photo is too big (5 MB at most).' };
    const fileId = (deps.uuid ?? (() => crypto.randomUUID()))();
    const path = `${found.user_id}/${id}/${fileId}.${ext}`;
    await deps.upload(path, bytes, mime);
    payload.files = [{ id: fileId, path, mime, size: bytes.length }];
    kind = 'image';
  }
  if (!text && !url && kind !== 'image') return { status: 400, message: 'Nothing to capture.' };

  await deps.insert({
    id,
    user_id: found.user_id,
    kind,
    text,
    url,
    payload,
    source: 'shortcut',
    status: 'unsorted',
    captured_at: (deps.now ?? (() => new Date()))().toISOString(),
  });
  return { status: 200, message: 'Saved to Airhead.' };
}
