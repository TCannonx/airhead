import { linkInfo, readingLine } from '../../lib/reading';
import type { Item } from '../../lib/schemas/records';
import { buttonClasses } from '../../ui/buttonClasses';

/**
 * About a saved link (Tasks 3.5 and 16.3): kind, minutes, the summary, key
 * points, why it was saved and its topics; an unreadable link shows its reason
 * and "Open anyway".
 */
export default function ReadingDetails({ item }: { item: Item }) {
  const d = item.data as {
    url?: string;
    summary?: string;
    key_points?: string[];
    reading_minutes?: number | null;
    description?: string | null;
    couldnt_read?: boolean;
  };
  if (item.type !== 'reading') return null;
  const link = linkInfo(item);
  const summary = link?.summary || d.summary || null;
  const points = link?.key_points.length ? link.key_points : (d.key_points ?? []);
  const unreadable = link ? link.status === 'unreadable' : !!d.couldnt_read;
  const minutes =
    link?.minutes ?? (typeof d.reading_minutes === 'number' ? d.reading_minutes : null);

  return (
    <section
      aria-label="About this link"
      className="space-y-2 rounded-card border border-border/60 bg-surface p-4"
    >
      {unreadable ? (
        <div className="space-y-2">
          <p className="text-footnote font-medium text-warning">
            Couldn&apos;t read this page
            {link?.reason ? `: ${link.reason}` : ' (paywall, login or app page)'}. Showing what is
            known.
          </p>
          {d.url && (
            <a
              href={d.url}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClasses('secondary', 'sm')}
            >
              Open anyway
            </a>
          )}
        </div>
      ) : link ? (
        <p className="text-caption text-fg-muted">
          {readingLine(item)}
          {link.source ? ` · ${link.source}` : ''}
        </p>
      ) : (
        minutes !== null && <p className="text-caption text-fg-muted">About {minutes} min read</p>
      )}
      {summary ? (
        <p className="whitespace-pre-wrap">{summary}</p>
      ) : (
        d.description && <p className="text-fg-muted">{d.description}</p>
      )}
      {points.length > 0 && (
        <ul aria-label="Key points" className="list-disc space-y-1 pl-5 text-footnote">
          {points.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      {link?.why_saved && (
        <p className="text-footnote">
          <span className="text-fg-muted">Why you saved it: </span>
          {link.why_saved}
        </p>
      )}
      {link && link.topics.length > 0 && (
        <p className="text-caption text-fg-muted">Topics: {link.topics.join(', ')}</p>
      )}
      {!summary && !unreadable && !d.description && (
        <p className="text-footnote text-fg-muted">This link will be read and summarised soon.</p>
      )}
    </section>
  );
}
