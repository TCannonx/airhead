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
      className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-900"
    >
      {d.couldnt_read && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Couldn&apos;t read this page (paywall, login or app page). Showing its title and
          description.
        </p>
      )}
      {typeof d.reading_minutes === 'number' && (
        <p className="text-xs text-slate-500">About {d.reading_minutes} min read</p>
      )}
      {d.summary ? (
        <p>{d.summary}</p>
      ) : (
        d.description && <p className="text-slate-600 dark:text-slate-300">{d.description}</p>
      )}
      {d.key_points && d.key_points.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {d.key_points.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      {!d.summary && !d.couldnt_read && !d.description && (
        <p className="text-sm text-slate-500">This link will be read and summarised soon.</p>
      )}
    </section>
  );
}
