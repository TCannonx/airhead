import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { buildEvents, localMidnight } from '../../lib/calendar/sources';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newItem, save } from '../../lib/db/repository';
import type { Series } from '../../lib/schemas/records';
import { DEFAULT_WORK_SETTINGS } from '../../lib/work/settings';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const series = (fields: Partial<Series> = {}): Series => ({
  ...baseRecord(U),
  name: 'Club 2027',
  calendar: 'us',
  colour: null,
  source_kind: 'import',
  source_path: null,
  data: {},
  ...fields,
});

function renderImport() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider
            router={createMemoryRouter(routes, { initialEntries: ['/calendar/import'] })}
          />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('imported series', () => {
  it('a series colour colours its events on the calendar', () => {
    const s = series({ colour: '#be185d' });
    const e = newItem(U, {
      type: 'event',
      title: 'Match',
      calendar: 'us',
      series_id: s.id,
      start_at: '2027-03-06T19:00:00.000Z',
    });
    const other = newItem(U, {
      type: 'event',
      title: 'Other',
      calendar: 'us',
      start_at: '2027-03-06T12:00:00.000Z',
    });
    const out = buildEvents(
      {
        items: [e, other],
        external: [],
        feeds: [],
        leave: [],
        workDays: [],
        work: DEFAULT_WORK_SETTINGS,
        series: [s],
      },
      {
        start: new Date(localMidnight('2027-03-01', 'Europe/Dublin')),
        end: new Date(localMidnight('2027-03-08', 'Europe/Dublin')),
      },
      'Europe/Dublin',
      new Set(['holidays']),
    );
    expect(out.map((x) => [x.title, x.color])).toEqual([
      ['Match', '#be185d'],
      ['Other', '#e11d48'],
    ]);
  });

  it('deletes a whole series after a second tap, and recolours it', async () => {
    const d = db();
    const s = await save(d, 'series', series());
    for (const day of ['2027-03-06', '2027-03-13']) {
      await save(
        d,
        'items',
        newItem(U, {
          type: 'event',
          title: `Match ${day}`,
          series_id: s.id,
          calendar: 'us',
          all_day: true,
          start_at: localMidnight(day, 'Europe/Dublin'),
        }),
      );
    }
    await save(
      d,
      'items',
      newItem(U, { type: 'event', title: 'Not in it', start_at: '2027-03-06T12:00:00.000Z' }),
    );
    d.close();

    const user = userEvent.setup();
    renderImport();
    const list = await screen.findByRole('list', { name: 'Imported schedules' });
    expect(within(list).getByText(/2 events · Us/)).toBeInTheDocument();
    await user.selectOptions(within(list).getByLabelText('Colour for Club 2027'), '#0369a1');
    await user.click(within(list).getByRole('button', { name: 'Delete Club 2027' }));
    await user.click(within(list).getByRole('button', { name: 'Delete 2 events' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Imported schedules' })).not.toBeInTheDocument(),
    );

    const x = db();
    const [items, stored] = await Promise.all([x.items.toArray(), x.series.get(s.id)]);
    x.close();
    expect(stored).toMatchObject({ colour: '#0369a1' });
    expect(stored?.deleted_at).toBeTruthy();
    expect(
      items
        .filter((i) => i.deleted_at)
        .map((i) => i.title)
        .sort(),
    ).toEqual(['Match 2027-03-06', 'Match 2027-03-13']);
    expect(items.find((i) => i.title === 'Not in it')?.deleted_at).toBeNull();
  });
});
