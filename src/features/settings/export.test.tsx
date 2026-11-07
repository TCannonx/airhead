import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';

beforeEach(async () => {
  localStorage.clear();
  await openUserDb(LOCAL_USER_ID).delete();
});
afterEach(() => vi.restoreAllMocks());

describe('Settings → Export', () => {
  it('downloads a dated zip of everything', async () => {
    const createObjectURL = vi.fn(() => 'blob:export');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    render(
      <AuthProvider services={localServices()}>
        <DataProvider userId={LOCAL_USER_ID}>
          <AppLockProvider>
            <RouterProvider
              router={createMemoryRouter(routes, { initialEntries: ['/settings'] })}
            />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Export everything' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.size).toBeGreaterThan(0);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^airhead-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(await screen.findByText(/Export downloaded/)).toBeVisible();
  });
});
