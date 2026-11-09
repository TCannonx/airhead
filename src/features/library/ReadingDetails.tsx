import type { Item } from '../../lib/schemas/records';

/** Summary, key points and reading time from link reading (Task 3.5). */
export default function ReadingDetails({ item }: { item: Item }) {
  const d = item.data as {
    summary?: string;
    key_points?: string[];
    reading_minutes?: number | null;
    description?: string | null;
    couldnt_read?: boolean;
  };
  if (item.type !== 'reading') return null;
  return (
    <section
      aria-label="About this link"
      className="space-y-2 rounded-card border border-border/60 bg-surface p-4"
    >
      {d.couldnt_read && (
        <p className="text-footnote font-medium text-warning">
          Couldn&apos;t read this page (paywall, login or app page). Showing its title and
          description.
        </p>
      )}
      {typeof d.reading_minutes === 'number' && (
        <p className="text-caption text-fg-muted">About {d.reading_minutes} min read</p>
      )}
      {d.summary ? (
        <p>{d.summary}</p>
      ) : (
        d.description && <p className="text-fg-muted">{d.description}</p>
      )}
      {d.key_points && d.key_points.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-footnote">
          {d.key_points.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      {!d.summary && !d.couldnt_read && !d.description && (
        <p className="text-footnote text-fg-muted">This link will be read and summarised soon.</p>
      )}
    </section>
  );
}
