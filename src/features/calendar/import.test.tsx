import { readFileSync } from 'node:fs';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../tests/fixtures/ai/import-screenshot.json';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { ImportRequest, Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderImport(services: Services = localServices()) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={services}>
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

const stored = async () => {
  const d = db();
  const [items, series, leave] = await Promise.all([
    d.items.toArray(),
    d.series.toArray(),
    d.leave_bookings.toArray(),
  ]);
  d.close();
  return { items, series, leave };
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-10T10:00:00Z'));
  localStorage.clear();
  await db().delete();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Calendar → Import (Task 4.10)', () => {
  it('a CSV: map the columns, keep only home games, review and save as a series', async () => {
    const user = userEvent.setup();
    renderImport();
    const csv = new File(
      [readFileSync('tests/fixtures/import/fixtures.csv')],
      'Club fixtures 2027.csv',
      {
        type: 'text/csv',
      },
    );
    await user.upload(await screen.findByLabelText('File'), csv);
    await user.type(screen.getByLabelText('Instruction (optional)'), 'only home games');
    await user.click(screen.getByRole('button', { name: 'Read schedule' }));

    // Mapping: guessed from the headings.
    expect(await screen.findByLabelText('Column 1')).toHaveValue('date');
    expect(screen.getByLabelText('Column 3')).toHaveValue('time');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText("2 events found (home games of St Vincent's)."),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Proposed events' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('time TBC')).toBeInTheDocument();
    expect(screen.getByLabelText('Series name')).toHaveValue('Club fixtures 2027');
    await user.selectOptions(screen.getByLabelText('Calendar'), 'us');
    await user.click(screen.getByRole('button', { name: 'Save 2 events' }));

    expect(await screen.findByText('Saved 2 events as “Club fixtures 2027”.')).toBeInTheDocument();
    const { items, series } = await stored();
    expect(series[0]).toMatchObject({
      name: 'Club fixtures 2027',
      calendar: 'us',
      source_kind: 'import',
    });
    expect(items.map((i) => [i.title, i.all_day, i.calendar]).sort()).toEqual([
      ["St Vincent's v Kilmacud Crokes", false, 'us'],
      ["St Vincent's v Na Fianna", true, 'us'],
    ]);
  });

  it('a screenshot is read once by AI; a working-day event can book leave; Undo removes it all', async () => {
    const extract = vi.fn((req: ImportRequest) => {
      void req;
      return Promise.resolve({
        ok: true as const,
        error_code: null,
        message: 'Found 4 events.',
        kind: 'events' as const,
        events: fixture.output.events
          .filter((e) => e.title && /^\d{4}-/.test(e.date))
          // Move one match to Thursday 18 March, a working day.
          .map((e) => (e.title === 'Dublin v Derry' ? { ...e, date: '2027-03-18' } : e)),
      });
    });
    const user = userEvent.setup();
    renderImport({ ...localServices(), imports: { extract } });
    const shot = new File([new Uint8Array([137, 80, 78, 71])], 'fixtures.png', {
      type: 'image/png',
    });
    await user.upload(await screen.findByLabelText('File'), shot);
    await user.type(screen.getByLabelText('Instruction (optional)'), 'only home games');
    await user.click(screen.getByRole('button', { name: 'Read schedule' }));

    const table = await screen.findByRole('table', { name: 'Proposed events' });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]?.[0]).toMatchObject({
      kind: 'image',
      media_type: 'image/png',
      instruction: 'only home games',
      today: '2027-01-10',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    await user.click(
      within(table).getByRole('checkbox', { name: 'Add Dublin v Mayo (League R3)' }),
    );
    // Only the Thursday match offers leave (the others are on Saturdays).
    const offers = within(table).getAllByLabelText('Working day: book leave');
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    if (!offer) throw new Error('no leave offer');
    await user.click(offer);
    await user.click(screen.getByRole('button', { name: 'Save 3 events' }));
    await screen.findByText(/Saved 3 events/);
    const saved = await stored();
    expect(saved.items).toHaveLength(3);
    expect(saved.leave[0]).toMatchObject({
      start_date: '2027-03-18',
      end_date: '2027-03-18',
      status: 'planned',
      note: 'Dublin v Derry',
      days: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const { items, series } = await stored();
      expect(items.every((i) => i.deleted_at)).toBe(true);
      expect(series.every((s) => s.deleted_at)).toBe(true);
    });
  });

  it('without a server, AI routes explain what still works offline', async () => {
    const user = userEvent.setup();
    renderImport();
    await user.click(await screen.findByRole('tab', { name: 'Paste text' }));
    await user.type(screen.getByLabelText('Schedule text'), 'Sat 6 March v Kilmacud 7pm');
    await user.click(screen.getByRole('button', { name: 'Read schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '.ics, CSV and Excel files work offline',
    );
  });
});
