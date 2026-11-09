import { NOTE_TEXT_MAX, type NoteForSorting } from '../_shared/prompts/sort-batch.v7.ts';
import { noteText } from '../summarise-note/run.ts';
import type { NoteSeen } from './plan.ts';

/**
 * Notes in the sorting batch (Task 11.0): typed notes, meeting notes and ideas
 * the person changed since the AI last looked. Each look sends only the text
 * since the last one (at most NOTE_TEXT_MAX characters) and records its length
 * and hash in the note's data (ai_seen_len, ai_seen_hash), so the next look can
 * tell an addition (send what follows) from an edit (send the note again).
 */

/** At most this many notes per batch. */
export const NOTES_PER_BATCH = 5;

/** A row of notes_for_sorting(). */
export interface NoteRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  doc: { html?: unknown } | null;
}

/** FNV-1a, 32 bits, as hex: enough to notice that earlier text changed. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The note's whole visible text: a typed document, else the item's body (or an idea's title). */
export function fullNoteText(row: NoteRow): string {
  if (row.doc && typeof row.doc.html === 'string') return noteText(row.doc.html);
  const body = (row.body ?? '').trim();
  return body || (row.type === 'idea' ? row.title.trim() : '');
}

/**
 * What to send for a note, and what to stamp. `send` is null when nothing new
 * is there (the note is still stamped as seen, without an AI call for it).
 */
export function noteForSorting(row: NoteRow): { send: NoteForSorting | null; seen: NoteSeen } {
  const text = fullNoteText(row);
  const data = row.data ?? {};
  const len = typeof data.ai_seen_len === 'number' ? data.ai_seen_len : 0;
  const hash = typeof data.ai_seen_hash === 'string' ? data.ai_seen_hash : null;
  // Added to since the last look: only what follows. Edited (or never seen): all of it.
  const added = len > 0 && len <= text.length && hash === textHash(text.slice(0, len));
  const fresh = (added ? text.slice(len) : text).trim().slice(0, NOTE_TEXT_MAX);
  return {
    send: fresh ? { id: row.id, title: row.title.trim() || 'Note', text: fresh } : null,
    seen: { id: row.id, seen_len: text.length, seen_hash: textHash(text) },
  };
}
