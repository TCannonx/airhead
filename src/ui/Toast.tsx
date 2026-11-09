import { useEffect, useEffectEvent } from 'react';
import { cx, FOCUS_RING } from './cx';

/** How long a toast stays up by default (the capture "Undo" toast: 8 seconds). */
export const TOAST_MS = 8_000;

export interface ToastProps {
  message: string;
  /** One action, usually Undo. Clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Called when the toast times out or its action runs. */
  onDismiss: () => void;
  /** Milliseconds before it dismisses itself; 0 keeps it up. */
  duration?: number;
  className?: string;
}

/**
 * A short message above the tab bar (phone) or at the bottom (iPad, desktop).
 * Announced politely; render it only while there is something to say.
 */
export function Toast({ message, action, onDismiss, duration = TOAST_MS, className }: ToastProps) {
  const dismiss = useEffectEvent(() => onDismiss());

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(dismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  return (
    <div
      role="status"
      className={cx(
        'fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card px-4 py-3 text-footnote shadow-lg md:bottom-8',
        'bg-fg text-canvas',
        className,
      )}
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          className={cx('min-h-8 rounded-md px-2 font-semibold text-accent-soft', FOCUS_RING)}
          onClick={() => {
            onDismiss();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
