import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { SyncIndicator } from '../features/sync/SyncIndicator';
import { Icon } from './Icon';
import { useLayout } from './layout';
import { SETTINGS, TABS, type NavItem } from './nav';

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-lg font-semibold tracking-tight">
      <img src="/logo.svg" alt="" className="size-7 rounded-lg" />
      <span>Airhead</span>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
          isActive
            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`
      }
    >
      <Icon name={item.icon} className="size-5" />
      {item.label}
    </NavLink>
  );
}

function Sidebar() {
  return (
    <div className="flex w-56 shrink-0 flex-col gap-4 border-r border-slate-200 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] dark:border-slate-800">
      <Brand />
      <SyncIndicator className="-mt-3 px-3" />
      <nav aria-label="Sidebar" className="flex flex-1 flex-col gap-1">
        {TABS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
        <div className="mt-auto">
          <SidebarLink item={SETTINGS} />
        </div>
      </nav>
    </div>
  );
}

function PhoneLayout() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-2 pt-[env(safe-area-inset-top)] dark:border-slate-800">
        <Brand />
        <SyncIndicator className="ml-auto mr-1" />
        <NavLink
          to={SETTINGS.to}
          aria-label="Settings"
          className="rounded-lg p-2 text-slate-600 dark:text-slate-300"
        >
          <Icon name="settings" />
        </NavLink>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <Outlet />
      </main>
      <nav
        aria-label="Tabs"
        className="grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950"
      >
        {TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
              }`
            }
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function TabletLayout() {
  return (
    <div className="flex h-dvh">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-6 py-6 pr-[max(1.5rem,env(safe-area-inset-right))]">
        <Outlet />
      </main>
    </div>
  );
}

function DesktopLayout() {
  return (
    <div className="flex h-dvh">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <Outlet />
      </main>
      <aside
        aria-label="Side panel"
        className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 p-6 dark:border-slate-800"
      >
        <p className="text-sm text-slate-500">Today at a glance appears here.</p>
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
    <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {layout === 'phone' && <PhoneLayout />}
      {layout === 'tablet' && <TabletLayout />}
      {layout === 'desktop' && <DesktopLayout />}
    </div>
  );
}
