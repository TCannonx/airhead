import { useRef, type KeyboardEvent } from 'react';
import { cx, FOCUS_RING } from './cx';

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group, e.g. "View". */
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Two to five mutually exclusive choices (Day / Week / Month). A radio group:
 * Tab enters on the selected option, arrow keys, Home and End move and select.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (index: number) => {
    const next = (index + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    };
    const target = keys[e.key];
    if (target === undefined) return;
    e.preventDefault();
    move(target);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('inline-flex rounded-control bg-fill p-0.5', className)}
    >
      {options.map((o, i) => {
        const selected = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-8 flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 text-footnote font-medium whitespace-nowrap transition',
              selected ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              FOCUS_RING,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
