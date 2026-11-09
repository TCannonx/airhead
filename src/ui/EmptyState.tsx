import type { ReactNode } from 'react';
import { Icon, type IconName } from '../app/Icon';
import { cx } from './cx';

export interface EmptyStateProps {
  title: string;
  /** One short sentence: what goes here, or what to do next. */
  message?: ReactNode;
  icon?: IconName;
  /** Usually one Button. */
  action?: ReactNode;
  className?: string;
}

/** What a list or page shows when there is nothing in it yet. */
export function EmptyState({ title, message, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      {icon && (
        <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-fill text-fg-muted">
          <Icon name={icon} />
        </span>
      )}
      <p className="text-headline">{title}</p>
      {message && <p className="mt-1 max-w-xs text-footnote text-fg-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
