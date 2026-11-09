import { cx } from './cx';

/** Small spinning ring for loading states. Decorative: pair it with text or aria-busy. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}
