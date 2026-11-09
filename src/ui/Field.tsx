import type { ReactNode } from 'react';
import type { FieldChrome, useFieldIds } from './fieldParts';
import { cx } from './cx';

export function Field({
  ids,
  chrome,
  className,
  children,
}: {
  ids: ReturnType<typeof useFieldIds>;
  chrome: FieldChrome;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label
        htmlFor={ids.id}
        className={cx('text-footnote font-medium text-fg-muted', chrome.hideLabel && 'sr-only')}
      >
        {chrome.label}
      </label>
      {children}
      {chrome.hint && (
        <p id={ids.hintId} className="text-caption text-fg-muted">
          {chrome.hint}
        </p>
      )}
      {chrome.error && (
        <p id={ids.errorId} role="alert" className="text-caption text-danger">
          {chrome.error}
        </p>
      )}
    </div>
  );
}
