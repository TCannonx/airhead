import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newCapture, newItem, save } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const CAP = '22222222-2222-4222-8222-222222222222';

function setup(services: Services) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/insights'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  const d = db();
  for (let i = 0; i < 30; i++) await save(d, 'captures', newCapture(U, { text: `c${i}` }));
  for (let i = 0; i < 10; i++) {
    await save(d, 'items', newItem(U, { type: 'task', title: `t${i}`, capture_id: CAP }));
  }
  await save(d, 'corrections', { ...baseRecord(U), capture_id: CAP, from_value: {}, to_value: {} });
  d.close();
});

describe('Insights → Success measures', () => {
  it('shows captures per day and the sorting correction rate from local data', async () => {
    setup(localServices());
    const section = await screen.findByRole('region', { name: 'Success measures' });
    expect(await within(section).findByText('1.0')).toBeVisible(); // 30 captures / 30 days
    expect(within(section).getByText('10%')).toBeVisible();
    expect(within(section).getByText(/1 of 10 sorted items corrected/)).toBeVisible();
    expect(within(section).getByText(/rising rate means sorting needs tuning/i)).toBeVisible();
  });

  it('shows AI cost per month when connected', async () => {
    const month = new Date().toISOString().slice(0, 7);
    setup({
      ...localServices(),
      usage: {
        monthRows: vi.fn(async () => [
          {
            task: 'sort_batch',
            tier: 'small' as const,
            model: 'm',
            cost_eur: 0.42,
            ok: true,
            error_code: null,
            created_at: `${month}-02T12:00:00Z`,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
          },
        ]),
        prices: vi.fn(async () => []),
        savePrice: vi.fn(async () => {}),
      },
    });
    const section = await screen.findByRole('region', { name: 'Success measures' });
    const costs = await within(section).findByRole('list', { name: 'AI cost per month' });
    expect(within(costs).getAllByRole('listitem')).toHaveLength(3);
    expect(within(costs).getByText('€0.42')).toBeVisible();
  });
});
