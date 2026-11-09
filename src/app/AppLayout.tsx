import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useInboxCount } from '../features/inbox/useInboxCount';
import { SyncIndicator } from '../features/sync/SyncIndicator';
import TodayGlance from '../features/today/TodayGlance';
import LocationPicker from '../features/work/LocationPicker';
import { Badge } from '../ui/Chip';
import { CompactTitleContext } from '../ui/compactTitle';
import { cx } from '../ui/cx';
import { Icon } from './Icon';
import { useLayout } from './layout';
import { CALENDAR, SETTINGS, TABS, type NavItem } from './nav';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cx(
        'flex items-center gap-2 font-semibold tracking-tight',
        compact ? 'text-headline' : 'px-3 py-2 text-lg',
      )}
    >
      <img src="/logo.svg" alt="" className={compact ? 'size-6 rounded-md' : 'size-7 rounded-lg'} />
      <span>Airhead</span>
    </div>
  );
}

/** Badge for a nav item (only the Inbox has one). */
function NavBadge({
  item,
  count,
  className,
}: {
  item: NavItem;
  count: number;
  className?: string;
}) {
  return item.to === '/inbox' ? <Badge count={count} className={className} /> : null;
}

function SidebarLink({ item, count = 0 }: { item: NavItem; count?: number }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cx(
          'flex min-h-10 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition',
          'outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isActive
            ? 'bg-accent-soft text-on-accent-soft'
            : 'text-fg-muted hover:bg-fill hover:text-fg',
        )
      }
    >
      <Icon name={item.icon} className="size-5" />
      <span className="flex-1">{item.label}</span>
      <NavBadge item={item} count={count} />
    </NavLink>
  );
}

function Sidebar({ inbox }: { inbox: number }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-4 border-r border-border/70 bg-surface p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))]">
      <Brand />
      <SyncIndicator className="-mt-3 px-3" />
      <nav aria-label="Sidebar" className="flex flex-1 flex-col gap-0.5">
        {TABS.map((item) => (
          <div key={item.to} className="contents">
            <SidebarLink item={item} count={inbox} />
            {item.to === '/today' && <SidebarLink item={CALENDAR} />}
          </div>
        ))}
        <div className="mt-auto">
          <SidebarLink item={SETTINGS} />
        </div>
      </nav>
    </div>
  );
}

function HeaderLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      className={({ isActive }) =>
        cx(
          'inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isActive ? 'text-accent' : 'text-fg-muted',
        )
      }
    >
      <Icon name={item.icon} />
    </NavLink>
  );
}

function TabBar({ inbox }: { inbox: number }) {
  return (
    <nav
      aria-label="Tabs"
      className="grid grid-cols-5 border-t border-border/70 bg-surface/90 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-xl"
    >
      {TABS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cx(
              'flex min-h-[3.0625rem] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[0.6875rem] font-medium outline-none focus-visible:bg-fill',
              isActive ? 'text-accent' : 'text-fg-subtle',
            )
          }
        >
          <span className="relative">
            <Icon name={item.icon} />
            <NavBadge item={item} count={inbox} className="absolute -top-1 left-4" />
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function PhoneLayout({ compactTitle, inbox }: { compactTitle: string | null; inbox: number }) {
  return (
    <div className="flex h-dvh flex-col">
      <header
        className={cx(
          'relative flex min-h-11 items-center gap-1 bg-canvas/90 pt-[env(safe-area-inset-top)] pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl transition-colors',
          compactTitle ? 'border-b border-border/70' : 'border-b border-transparent',
        )}
      >
        {compactTitle ? (
          <span
            aria-hidden="true"
            data-testid="compact-title"
            className="min-w-0 flex-1 truncate text-headline"
          >
            {compactTitle}
          </span>
        ) : (
          <div className="flex-1">
            <Brand compact />
          </div>
        )}
        <SyncIndicator className="mr-1" />
        <HeaderLink item={CALENDAR} />
        <HeaderLink item={SETTINGS} />
      </header>
      <main className="flex-1 overflow-y-auto px-gutter pt-2 pb-8">
        <Outlet />
      </main>
      <TabBar inbox={inbox} />
    </div>
  );
}

function TabletLayout({ inbox }: { inbox: number }) {
  return (
    <div className="flex h-dvh">
      <Sidebar inbox={inbox} />
      <main className="flex-1 overflow-y-auto px-6 py-6 pr-[max(1.5rem,env(safe-area-inset-right))]">
        <Outlet />
      </main>
    </div>
  );
}

function DesktopLayout({ inbox }: { inbox: number }) {
  return (
    <div className="flex h-dvh">
      <Sidebar inbox={inbox} />
      <main className="flex-1 overflow-y-auto px-gutter-wide py-6">
        <Outlet />
      </main>
      <aside
        aria-label="Side panel"
        className="w-80 shrink-0 overflow-y-auto border-l border-border/70 bg-surface p-6"
      >
        <h2 className="mb-2 text-footnote font-medium tracking-wide text-fg-muted uppercase">
          Today
        </h2>
        <LocationPicker />
        <TodayGlance />
      </aside>
    </div>
  );
}

const isTyping = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable);

export default function AppLayout() {
  const layout = useLayout();
  const navigate = useNavigate();
  const inbox = useInboxCount();
  // Set by PageHeader once the large title scrolls away (phone top bar shows it).
  const [compactTitle, setCompactTitle] = useState<string | null>(null);

  // Desktop shortcut: "/" jumps to the (visible) Library search box.
  useEffect(() => {
    if (layout === 'phone') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement))
        return;
      e.preventDefault();
      void navigate('/library', { state: { focusSearch: Date.now() } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, navigate]);
  return (
    <CompactTitleContext value={setCompactTitle}>
      <div className="bg-canvas text-fg">
        {layout === 'phone' && <PhoneLayout compactTitle={compactTitle} inbox={inbox} />}
        {layout === 'tablet' && <TabletLayout inbox={inbox} />}
        {layout === 'desktop' && <DesktopLayout inbox={inbox} />}
      </div>
    </CompactTitleContext>
  );
}
