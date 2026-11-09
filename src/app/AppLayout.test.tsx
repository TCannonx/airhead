import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { AppLockProvider } from '../features/applock/AppLockProvider';
import { AuthProvider } from '../lib/auth/AuthProvider';
import { DataProvider } from '../lib/db/DataProvider';
import { localServices } from '../lib/auth/localAuth';
import { routes } from './routes';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function renderAt(width: number, path = '/capture') {
  setWidth(width);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider services={localServices()}>
      <DataProvider userId="00000000-0000-4000-8000-000000000001">
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const TABS = ['Capture', 'Today', 'Inbox', 'Library', 'Insights'];

describe('AppLayout', () => {
  it('phone (< 768 px): bottom tabs, no sidebar, no side panel', () => {
    renderAt(390);
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(TABS);
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).not.toBeInTheDocument();
    // Settings stays reachable from a visible button on the phone.
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('iPad (768-1279 px): sidebar plus one main pane', () => {
    renderAt(1024);
    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(
      within(sidebar)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Capture', 'Today', 'Calendar', 'Inbox', 'Library', 'Insights', 'Settings']);
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('desktop (>= 1280 px): sidebar, main pane and right panel', () => {
    renderAt(1440);
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
  });

  it('switches layout when the window is resized', () => {
    renderAt(390);
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeInTheDocument();
    act(() => {
      setWidth(1440);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument();
  });

  it('opens on Capture and marks the current tab', () => {
    renderAt(390, '/');
    expect(screen.getByRole('heading', { level: 1, name: 'Capture' })).toBeInTheDocument();
    const current = within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole('link', {
      current: 'page',
    });
    expect(current).toHaveTextContent('Capture');
  });

  it.each(['Today', 'Inbox', 'Library', 'Insights', 'Settings'])('routes to %s', (name) => {
    renderAt(1024, `/${name.toLowerCase()}`);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it('the Inbox tab shows a badge for captures waiting, without changing its name', async () => {
    renderAt(390);
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(within(tabs).queryByTestId('badge')).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('Capture'), 'ring the plumber{Enter}');
    const inbox = within(tabs).getByRole('link', { name: 'Inbox' });
    expect(await within(inbox).findByTestId('badge')).toHaveTextContent('1');
  });

  it('pages get the shared header: one h1 per page', () => {
    renderAt(1440, '/settings');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
