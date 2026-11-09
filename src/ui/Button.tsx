import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';
import { Spinner } from './Spinner';

export type { ButtonSize, ButtonVariant } from './buttonClasses';

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
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
