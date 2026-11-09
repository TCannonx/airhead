import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../app/Icon';
import { cx, FOCUS_RING } from './cx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required accessible name: the button shows no text. */
  label: string;
  tone?: 'default' | 'accent' | 'danger';
}

const TONE = {
  default: 'text-fg-muted hover:bg-fill',
  accent: 'text-accent hover:bg-accent-soft',
  danger: 'text-danger hover:bg-danger-soft',
};

/** A 44 px icon-only button (close, more, back). Always has an accessible name. */
export function IconButton({
  icon,
  label,
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50',
        TONE[tone],
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} className="size-6" />
    </button>
  );
}
