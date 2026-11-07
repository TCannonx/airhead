import { parseHTML } from 'npm:linkedom@0.18.15';

/** Plain text of typed note HTML, one line per block. */
export function htmlText(html: string): string {
  if (!html) return '';
  const spaced = html.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)[^>]*>/gi, '$&\n');
  const { document } = parseHTML(`<html><body>${spaced}</body></html>`) as unknown as {
    document: { body: { textContent: string | null } | null };
  };
  return (document.body?.textContent ?? '').trim();
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];

/** The parts of an item worth searching: body, note text, summaries, transcription, draft. */
export function itemParts(input: {
  body: string | null;
  data: Record<string, unknown>;
  noteDoc: { kind: string; doc: Record<string, unknown> } | null;
  draft: Record<string, unknown> | null;
}): string[] {
  const parts: (string | null)[] = [input.body];
  const d = input.data;
  // A reading item's summary is a string; a note's (6.7) is an object.
  if (typeof d.summary === 'string') parts.push(d.summary);
  parts.push(...strs(d.key_points));
  if (d.summary && typeof d.summary === 'object') {
    const s = d.summary as Record<string, unknown>;
    parts.push(str(s.summary), ...strs(s.decisions), str(s.transcription));
    if (Array.isArray(s.actions))
      parts.push(
        ...s.actions.map((a) =>
          a && typeof a === 'object' ? str((a as { title?: unknown }).title) : null,
        ),
      );
  }
  if (input.noteDoc) {
    const doc = input.noteDoc.doc;
    if (input.noteDoc.kind === 'typed')
      parts.push(htmlText(typeof doc.html === 'string' ? doc.html : ''));
    else if (Array.isArray(doc.pages))
      for (const p of doc.pages as { texts?: { text?: unknown }[] }[])
        for (const t of p.texts ?? []) parts.push(str(t.text));
  }
  if (input.draft) {
    const c = input.draft;
    parts.push(str(c.summary));
    if (Array.isArray(c.sections))
      for (const s of c.sections as { heading?: unknown; body?: unknown }[])
        parts.push(str(s.heading), str(s.body));
    parts.push(...strs(c.open_questions), ...strs(c.next_steps));
  }
  return parts.filter((p): p is string => !!p && !!p.trim());
}
