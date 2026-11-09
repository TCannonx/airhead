import { cx, FOCUS_RING } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-fill text-fg hover:brightness-95 dark:hover:brightness-125',
  plain: 'text-accent hover:bg-accent-soft',
  destructive: 'bg-danger-soft text-danger hover:brightness-95 dark:hover:brightness-125',
};

const SIZE: Record<ButtonSize, string> = {
  // Compact on desktop, still a 44 px target on touch screens.
  sm: 'min-h-8 px-3 text-footnote pointer-coarse:min-h-11',
  md: 'min-h-11 px-4 text-body',
  lg: 'min-h-12 w-full px-5 text-headline',
};

/**
 * The classes of a Button, for the rare control that must look like one but is
 * another element (a router Link, a label wrapping a file input).
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return cx(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold transition select-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    FOCUS_RING,
    className,
  );
}
