import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from '../app/Icon';
import { cx } from './cx';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading icon, drawn in a small tinted tile. */
  icon?: IconName;
  /** Tile colour class for the icon, e.g. "bg-accent". */
  iconTint?: string;
  /** Right-hand value or control ("On", a Chip, a Toggle). */
  trailing?: ReactNode;
  /** Makes the row a link (with a chevron). */
  to?: string;
  /** Makes the row a button (with a chevron unless chevron is false). */
  onClick?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  className?: string;
}

/**
 * One row of a GroupedList, at least 44 px tall. With `to` it is a link, with
 * `onClick` a button, otherwise plain content. Its accessible name is the title
 * (plus subtitle) so tests and screen readers find it by what it says.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  iconTint = 'bg-accent',
  trailing,
  to,
  onClick,
  chevron,
  destructive = false,
  className,
}: ListRowProps) {
  const interactive = to !== undefined || onClick !== undefined;
  const showChevron = chevron ?? interactive;
  const inner = (
    <>
      {icon && (
        <span
          aria-hidden="true"
          className={cx(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white',
            iconTint,
          )}
        >
          <Icon name={icon} className="size-[1.125rem]" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className={cx('block text-body', destructive && 'text-danger')}>{title}</span>
        {subtitle && <span className="block text-footnote text-fg-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-body text-fg-muted">{trailing}</span>}
      {showChevron && <Icon name="chevron-right" className="size-4 shrink-0 text-fg-subtle" />}
    </>
  );
  const rowClass = cx(
    'flex min-h-11 w-full items-center gap-3 px-4 py-2.5',
    interactive && 'transition outline-none hover:bg-fill/60 focus-visible:bg-fill active:bg-fill',
    className,
  );
  return (
    <li>
      {to !== undefined ? (
        <Link to={to} className={rowClass}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {inner}
        </button>
      ) : (
        <div className={rowClass}>{inner}</div>
      )}
    </li>
  );
}
