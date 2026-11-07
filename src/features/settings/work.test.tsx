import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { updateSettingsData } from '../../lib/db/settings';
import { readWorkSettings } from '../../lib/work/settings';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderSettings() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/settings'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const stored = async () => {
  const d = db();
  const s = await d.settings.get(U);
  d.close();
  return readWorkSettings(s);
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Settings → Work (Task 4.4)', () => {
  it('shows the defaults and saves changes to the synced settings row', async () => {
    const user = userEvent.setup();
    renderSettings();
    const save = await screen.findByRole('button', { name: 'Save work settings' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Leave year start month' })).toHaveValue('12');

    const entitlement = screen.getByRole('spinbutton', { name: 'Annual leave (days a year)' });
    await user.clear(entitlement);
    await user.type(entitlement, '23');
    await user.click(screen.getByRole('checkbox', { name: 'Fri' }));
    await user.click(screen.getByRole('radio', { name: 'An extra day of annual leave' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leave year start month' }), '1');
    await user.click(save);
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    const w = await stored();
    expect(w.entitlement).toBe(23);
    expect(w.working_days).toEqual([1, 2, 3, 4]);
    expect(w.weekend_holiday).toBe('extra_leave');
    expect(w.leave_year_start).toBe('01-01');
  });

  it('adds closure days, one-off holidays, leave types and checklists', async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole('button', { name: 'Save work settings' });

    await user.type(screen.getByLabelText('Closure day'), '2026-12-29');
    await user.click(screen.getByRole('button', { name: 'Add closure day' }));
    expect(
      within(screen.getByRole('list', { name: 'Closure days' })).getByText('2026-12-29'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Holiday date'), '2026-07-10');
    await user.type(screen.getByLabelText('Holiday name'), 'Company day');
    await user.click(screen.getByRole('button', { name: 'Add holiday' }));

    await user.type(screen.getByLabelText('New leave type'), 'Compassionate');
    await user.click(screen.getByRole('button', { name: 'Add leave type' }));

    const office = screen.getByLabelText('Office checklist');
    await user.clear(office);
    await user.type(office, 'Laptop{Enter}{Enter}Lunch');
    await user.selectOptions(screen.getByLabelText('Mon location'), 'wfh');
    await user.click(screen.getByRole('button', { name: 'Save work settings' }));
    await screen.findByText('Saved');

    const w = await stored();
    expect(w.closure_days).toEqual(['2026-12-29']);
    expect(w.manual_holidays).toEqual([{ date: '2026-07-10', name: 'Company day' }]);
    expect(w.leave_types.at(-1)).toEqual({
      key: 'compassionate',
      name: 'Compassionate',
      deducts: false,
    });
    expect(w.checklists.office).toEqual(['Laptop', 'Lunch']);
    expect(w.location_pattern['1']).toBe('wfh');
  });

  it('keeps other settings and picks up changes from another device', async () => {
    const d = db();
    await updateSettingsData(d, U, { other: 'kept', work: { entitlement: 30 } });
    d.close();
    renderSettings();
    expect(await screen.findByDisplayValue('30', {}, { timeout: 3000 })).toHaveAccessibleName(
      'Annual leave (days a year)',
    );
    const s = await (async () => {
      const x = db();
      const r = await x.settings.get(U);
      x.close();
      return r;
    })();
    expect(s?.data.other).toBe('kept');
  });
});
