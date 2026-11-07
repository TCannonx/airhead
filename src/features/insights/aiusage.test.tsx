import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services, UsageService } from '../../lib/auth/types';
import type { PriceRow, UsageRow } from '../../lib/ai/usage';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const today = new Date();
const iso = (d: number) =>
  new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), d, 12)).toISOString();

const ROWS: UsageRow[] = [
  {
    task: 'sort_batch',
    tier: 'small',
    model: 'claude-haiku-5-5',
    cost_eur: 0.12,
    ok: true,
    error_code: null,
    created_at: iso(1),
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
  },
  {
    task: 'read_link',
    tier: 'small',
    model: 'claude-haiku-5-5',
    cost_eur: 0.03,
    ok: true,
    error_code: null,
    created_at: iso(1),
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
  },
];
const PRICES: PriceRow[] = [
  {
    id: 'p1',
    user_id: null,
    model: 'claude-haiku-5-5',
    input_per_mtok: 0.1,
    output_per_mtok: 0.5,
    cache_read_per_mtok: 0.01,
    cache_write_per_mtok: 0.125,
    eur_rate: 0.86,
  },
];

function setup(usage?: UsageService) {
  const services: Services = { ...localServices(), usage };
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

const fakeUsage = () => ({
  monthRows: vi.fn(async () => ROWS),
  prices: vi.fn(async () => PRICES),
  savePrice: vi.fn(async (_price: Partial<PriceRow>) => {}),
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Insights → AI usage', () => {
  it('shows month to date, projection, by task and a daily chart with a table view', async () => {
    setup(fakeUsage());
    const section = await screen.findByRole('region', { name: 'AI usage' });
    expect(await within(section).findByText('€0.15')).toBeVisible();
    expect(within(section).getByText(/Projected by month-end/)).toBeVisible();
    const byTask = within(section).getByRole('table', { name: 'By task' });
    expect(within(byTask).getByText('Sorting')).toBeVisible();
    expect(within(byTask).getByText('Link reading')).toBeVisible();

    const chart = within(section).getByRole('img', { name: /Daily AI spend/ });
    expect(chart.querySelectorAll('rect[data-day]').length).toBe(today.getUTCDate());
    await userEvent.click(within(section).getByRole('button', { name: 'Show as table' }));
    expect(within(section).getByRole('table', { name: 'Daily AI spend' })).toBeVisible();
    expect(within(section).getByText(/Claude Console is the true record/)).toBeVisible();
  });

  it('saves the monthly limit to settings (synced to the server)', async () => {
    setup(fakeUsage());
    const cap = await screen.findByLabelText('Monthly limit (€)');
    await userEvent.clear(cap);
    await userEvent.type(cap, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    await waitFor(async () =>
      expect((await db().settings.get(U))?.data.ai_monthly_cap_eur).toBe(5),
    );
  });

  it('edits a price as the user’s own override', async () => {
    const usage = fakeUsage();
    setup(usage);
    const prices = await screen.findByRole('table', { name: 'Prices' });
    const input = await within(prices).findByLabelText(
      'claude-haiku-5-5 input $ per million tokens',
    );
    await userEvent.clear(input);
    await userEvent.type(input, '0.2');
    await userEvent.click(within(prices).getByRole('button', { name: 'Save claude-haiku-5-5' }));
    await waitFor(() => expect(usage.savePrice).toHaveBeenCalledOnce());
    expect(usage.savePrice.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      input_per_mtok: 0.2,
    });
  });

  it('explains when there is no server (local mode)', async () => {
    setup(undefined);
    expect(await screen.findByText(/AI usage shows here once Airhead is connected/)).toBeVisible();
  });

  it('shows a plain message when the usage cannot be loaded', async () => {
    setup({ ...fakeUsage(), monthRows: vi.fn(async () => Promise.reject(new Error('net'))) });
    expect(await screen.findByText(/couldn.t be loaded/i)).toBeVisible();
  });
});
