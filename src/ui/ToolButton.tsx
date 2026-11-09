import type { ButtonHTMLAttributes } from 'react';
import { cx, FOCUS_RING } from './cx';

export interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** For tools that stay on (Pen, Bold): announced with aria-pressed. Leave out for one-shot actions. */
  pressed?: boolean;
}

/**
 * A button in an editing toolbar (the note editor, the ink page). Quiet until
 * pressed; 32 px with a mouse, 44 px on touch screens.
 */
export function ToolButton({ pressed, className, type = 'button', ...rest }: ToolButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        'inline-flex min-h-8 min-w-8 items-center justify-center rounded-control px-2.5 text-footnote font-semibold transition pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-accent-soft text-on-accent-soft' : 'text-fg hover:bg-fill',
        FOCUS_RING,
        className,
      )}
      {...rest}
    />
  );
}
