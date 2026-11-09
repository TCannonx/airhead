import { useId, type ReactNode } from 'react';

export interface FieldChrome {
  /** Visible label, also the accessible name. */
  label: string;
  /** Hide the label visually (it stays the accessible name). */
  hideLabel?: boolean;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text under the control; marks the control invalid. */
  error?: string | null;
}

/** Shared label / hint / error wiring for TextField, TextArea and Select. */
export function useFieldIds(id?: string) {
  const auto = useId();
  const base = id ?? auto;
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

export function describedBy(ids: ReturnType<typeof useFieldIds>, f: FieldChrome) {
  return (
    [f.hint ? ids.hintId : null, f.error ? ids.errorId : null].filter(Boolean).join(' ') ||
    undefined
  );
}

export const CONTROL =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-subtle outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50 aria-invalid:border-danger';
