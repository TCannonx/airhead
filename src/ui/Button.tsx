import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx, FOCUS_RING } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-fill text-fg hover:brightness-95 dark:hover:brightness-125',
  plain: 'text-accent hover:bg-accent-soft',
  destructive: 'bg-danger-soft text-danger hover:brightness-95 dark:hover:brightness-125',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-footnote',
  md: 'min-h-11 px-4 text-body',
  lg: 'min-h-12 w-full px-5 text-headline',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks; the label stays readable. */
  loading?: boolean;
  /** Optional icon before the label. */
  icon?: ReactNode;
}

/**
 * The one button. primary = the main action on a screen (one per view),
 * secondary = everyday actions, plain = low-emphasis text actions,
 * destructive = delete, sign out, remove.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold transition select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
