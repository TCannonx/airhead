import { useId, type ReactNode } from 'react';
import { cx, FOCUS_RING } from './cx';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Helper text under the label. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** An on/off switch with its label on the left, iOS style. Space or Enter flips it. */
export function Toggle({ label, checked, onChange, hint, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={cx('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-body">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-caption text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-[1.9375rem] w-[3.1875rem] shrink-0 rounded-full transition disabled:opacity-50',
          checked ? 'bg-success' : 'bg-fill',
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-0.5 left-0.5 size-[1.6875rem] rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
