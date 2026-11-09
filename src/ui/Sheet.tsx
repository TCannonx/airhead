import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Shown as the sheet's heading and used as its accessible name. */
  title: string;
  children: ReactNode;
  /** Buttons along the bottom (Cancel / Save). */
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel: a bottom sheet on the phone, a centred dialog from iPad width up.
 * Traps focus, closes on Esc, the close button or a tap outside, and gives focus
 * back to whatever opened it.
 */
export function Sheet({ open, onClose, title, children, footer, className }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select');
    (first ?? panel.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6"
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="sheet-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={() => onClose()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[90dvh] w-full flex-col bg-surface-raised text-fg shadow-xl outline-none',
          'rounded-t-sheet pb-[env(safe-area-inset-bottom)] md:max-w-lg md:rounded-sheet md:pb-0',
          className,
        )}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-fill md:hidden"
        />
        <div className="flex items-center gap-2 py-1 pr-1 pl-5">
          <h2 id={titleId} className="flex-1 text-headline">
            {title}
          </h2>
          <IconButton icon="close" label="Close" onClick={() => onClose()} />
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
