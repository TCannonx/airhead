import { z } from 'npm:zod@4.6.7';

export const ImportResult = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      date: z.string(),
      start_time: z.string().nullable(),
      end_time: z.string().nullable(),
      end_date: z.string().nullable(),
      venue: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  skipped_note: z.string().nullable(),
});
export type ImportResultT = z.infer<typeof ImportResult>;
export type ExtractedEvent = ImportResultT['events'][number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (s: string | null, n: number) => (s && s.trim() ? s.trim().slice(0, n) : null);
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Keeps only well-formed events (the model's output is checked, not trusted). */
export function cleanEvents(result: ImportResultT, max = 400): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  for (const e of result.events.slice(0, max)) {
    if (!validDate(e.date) || !e.title.trim()) continue;
    const start = e.start_time && TIME.test(e.start_time) ? e.start_time : null;
    out.push({
      title: e.title.trim().slice(0, 200),
      date: e.date,
      start_time: start,
      end_time: start && e.end_time && TIME.test(e.end_time) ? e.end_time : null,
      end_date: e.end_date && validDate(e.end_date) && e.end_date > e.date ? e.end_date : null,
      venue: clip(e.venue, 200),
      notes: clip(e.notes, 500),
    });
  }
  return out;
}

export const MAX_TEXT = 60_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export interface ExtractRequest {
  kind: 'text' | 'image' | 'pdf' | 'link';
  text?: string;
  /** base64 for image and pdf */
  data?: string;
  media_type?: string;
  url?: string;
  instruction?: string;
  today?: string;
  time_zone?: string;
}

/** Checks the request before anything is fetched or sent to the AI. */
export function checkRequest(body: ExtractRequest): string | null {
  if (!['text', 'image', 'pdf', 'link'].includes(body.kind)) return 'Unknown kind of import.';
  if (body.kind === 'text' && !body.text?.trim()) return 'Paste the schedule first.';
  if (body.kind === 'text' && (body.text?.length ?? 0) > MAX_TEXT)
    return 'That text is too long to import in one go.';
  if (body.kind === 'image' && !IMAGE_TYPES.includes(body.media_type as ImageType))
    return 'Use a PNG, JPEG, WebP or GIF image.';
  if ((body.kind === 'image' || body.kind === 'pdf') && !body.data) return 'The file is missing.';
  if ((body.data?.length ?? 0) * 0.75 > MAX_FILE_BYTES) return 'That file is too big (over 5 MB).';
  if (body.kind === 'link' && !body.url) return 'Paste a link first.';
  if ((body.instruction?.length ?? 0) > 500) return 'Keep the instruction short.';
  return null;
}
