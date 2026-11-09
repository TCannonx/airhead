import { useState } from 'react';
import type { NoteDoc } from '../../lib/schemas/records';
import { useAuth } from '../../lib/auth/context';
import type { SummariseRequest } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import { renderInkPages } from '../../lib/ink/render';
import { readInk } from '../../lib/ink/strokes';
import { readSummary, SUMMARISE_COST_TEXT } from '../../lib/notes/summary';
import type { Item } from '../../lib/schemas/records';
import { useOnline } from '../../lib/useOnline';
import ActionItems from './ActionItems';
import { Button } from '../../ui/Button';

/**
 * Summarise (Task 6.7): one AI call that reads the note (pages as images when
 * handwritten) and returns a summary, decisions and action items. The result
 * is stored on the note item (`data.summary`) so it syncs and is searchable.
 */
export default function SummarisePanel({
  item,
  doc,
  render = renderInkPages,
}: {
  item: Item;
  doc: NoteDoc;
  /** Ink pages to PNGs; replaced in tests (jsdom has no canvas). */
  render?: typeof renderInkPages;
}) {
  const db = useDb();
  const { services } = useAuth();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stored = readSummary(item);
  const notes = services.notes;

  const run = async () => {
    if (!notes) return;
    setBusy(true);
    setMessage(null);
    try {
      const base = {
        title: item.title,
        date: typeof item.data.meeting_date === 'string' ? item.data.meeting_date : null,
        attendees: Array.isArray(item.data.attendees)
          ? item.data.attendees.filter((a): a is string => typeof a === 'string')
          : [],
      };
      let req: SummariseRequest;
      if (doc.kind === 'typed') {
        const html = typeof doc.doc.html === 'string' ? doc.doc.html : '';
        if (!html.replace(/<[^>]*>/g, '').trim()) {
          setMessage('Write something first.');
          return;
        }
        req = { ...base, kind: 'typed', html };
      } else {
        const images = await render(readInk(doc.doc));
        if (images.length === 0) {
          setMessage('Write something first.');
          return;
        }
        req = { ...base, kind: 'ink', images };
      }
      const outcome = await notes.summarise(req);
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      await update(db, 'items', item.id, {
        data: { ...item.data, summary: { ...outcome.result, at: new Date().toISOString() } },
      });
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Couldn’t summarise this note.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Summary" className="mb-4 rounded-card border border-border/60 p-3">
      {stored && (
        <div className="mb-3 space-y-2 text-footnote">
          <p>{stored.summary}</p>
          {stored.decisions.length > 0 && (
            <div>
              <h3 className="font-semibold">Decisions</h3>
              <ul className="list-disc pl-5">
                {stored.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {stored.actions.length > 0 && <ActionItems note={item} actions={stored.actions} />}
          {stored.transcription && (
            <details>
              <summary className="cursor-pointer font-semibold">Transcription</summary>
              <p className="mt-1 whitespace-pre-wrap text-fg-muted">{stored.transcription}</p>
            </details>
          )}
        </div>
      )}
      {!notes ? (
        <p className="text-footnote text-fg-muted">
          Summarise needs Airhead&apos;s server (sign in).
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" disabled={busy || !online} onClick={() => void run()}>
            {busy ? 'Summarising…' : stored ? 'Summarise again' : 'Done → Summarise'}
          </Button>
          <span className="text-caption text-fg-muted">
            {online ? `One AI call, ${SUMMARISE_COST_TEXT}.` : 'Summarise needs a connection.'}
          </span>
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 text-footnote text-warning">
          {message}
        </p>
      )}
    </section>
  );
}
