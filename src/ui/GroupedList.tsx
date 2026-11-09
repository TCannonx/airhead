import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SectionProps {
  /** Small heading above the group ("Account", "Sync"). Becomes an h2. */
  title?: string;
  /** Small print under the group. */
  footer?: ReactNode;
  /** Trailing control next to the heading (e.g. a plain "Edit" button). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A titled block of the page (iOS "inset grouped" section). Put a GroupedList
 * in it for rows, or a Card / free content for anything else.
 */
export function Section({ title, footer, action, children, className }: SectionProps) {
  return (
    <section className={cx('mb-8', className)}>
      {(title || action) && (
        <div className="mb-1.5 flex min-h-6 items-end justify-between gap-2 px-4">
          {title && (
            <h2 className="text-footnote font-medium tracking-wide text-fg-muted uppercase">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
      {footer && <div className="mt-1.5 px-4 text-footnote text-fg-muted">{footer}</div>}
    </section>
  );
}

export interface GroupedListProps {
  children: ReactNode;
  /** Accessible name for the list, e.g. "Devices". */
  label?: string;
  className?: string;
}

/** The rounded group that holds ListRows, separated by hairlines. Renders a <ul>. */
export function GroupedList({ children, label, className }: GroupedListProps) {
  return (
    <ul
      aria-label={label}
      className={cx(
        'divide-y divide-border/70 overflow-hidden rounded-card border border-border/60 bg-surface',
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** Free content inside a GroupedList (a form, a paragraph), padded like a row. */
export function GroupedListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <li className={cx('px-4 py-3', className)}>{children}</li>;
}
