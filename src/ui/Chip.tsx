import type { ReactNode } from 'react';
import { cx, FOCUS_RING } from './cx';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-fill text-fg-muted',
  accent: 'bg-accent-soft text-on-accent-soft',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  /** Makes the chip a toggle button (filters). Pressed state is announced. */
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

/** A small label: a status ("This device") or, with onClick, a filter toggle. */
export function Chip({ children, tone = 'neutral', onClick, selected, className }: ChipProps) {
  const classes = cx(
    'inline-flex min-h-6 items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium',
    selected ? 'bg-accent text-accent-fg' : TONE[tone],
    className,
  );
  if (!onClick) return <span className={classes}>{children}</span>;
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      onClick={onClick}
      className={cx(classes, 'min-h-8 px-3', FOCUS_RING)}
    >
      {children}
    </button>
  );
}

/** A count bubble (Inbox 3). Hidden from screen readers: say the count in text nearby. */
export function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="badge"
      className={cx(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-danger px-1 text-[0.6875rem] leading-none font-semibold text-white tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
