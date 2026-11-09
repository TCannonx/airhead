import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../app/Icon';
import { useSetCompactTitle } from './compactTitle';
import { cx, FOCUS_RING } from './cx';

export interface PageHeaderProps {
  /** The page's h1. */
  title: string;
  /** Buttons on the right of the title (IconButton or a plain Button). */
  actions?: ReactNode;
  /** A back link above the title, e.g. { to: '/library', label: 'Library' }. */
  back?: { to: string; label: string };
  className?: string;
}

/**
 * Large page title, with optional back link and actions. On the phone, once the
 * title scrolls out of view the shell's top bar shows it small instead.
 */
export function PageHeader({ title, actions, back, className }: PageHeaderProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const setCompact = useSetCompactTitle();

  useEffect(() => {
    const el = heading.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const collapsed = !entry.isIntersecting;
      el.dataset.collapsed = String(collapsed);
      setCompact(collapsed ? title : null);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      setCompact(null);
    };
  }, [title, setCompact]);

  return (
    <header className={cx('mb-5', className)}>
      {back && (
        <Link
          to={back.to}
          className={cx(
            '-ml-1.5 mb-1 inline-flex min-h-8 items-center gap-0.5 rounded-md pr-2 text-body text-accent',
            FOCUS_RING,
          )}
        >
          <Icon name="chevron-left" className="size-5" />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 ref={heading} className="min-w-0 text-title break-words">
          {title}
        </h1>
        {actions && <div className="flex shrink-0 items-center gap-1 pt-0.5">{actions}</div>}
      </div>
    </header>
  );
}
