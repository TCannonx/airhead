import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the inner padding (for lists or media that run edge to edge). */
  flush?: boolean;
}

/** A raised surface for free-form content. Use GroupedList for rows of settings or items. */
export function Card({ flush = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rounded-card border border-border/60 bg-surface text-fg shadow-xs',
        !flush && 'p-4',
        className,
      )}
      {...rest}
    />
  );
}
