import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import EventEditor from './EventEditor';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderEditor(item?: Item) {
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <EventEditor
          draft={{
            item,
            start: new Date('2027-03-06T19:00:00Z'),
            end: new Date('2027-03-06T20:00:00Z'),
            allDay: false,
          }}
          onClose={() => {}}
        />
      </DataProvider>
    </AuthProvider>,
  );
}

const items = async () => {
  const d = db();
  const all = await d.items.toArray();
  d.close();
  return all;
};

beforeEach(async () => {
  await db().delete();
});

describe('event reminders in the editor (Task 4.12)', () => {
  it('a new event can have its own reminder', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(await screen.findByLabelText('Title'), 'Match');
    await user.selectOptions(screen.getByLabelText('Reminder'), '60');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await items())[0]?.data).toEqual({ reminder_minutes: '60' }));
  });

  it('"Default reminder" removes an override; other data is kept', async () => {
    const d = db();
    const item = await save(
      d,
      'items',
      newItem(U, {
        type: 'event',
        title: 'Dentist',
        start_at: '2027-03-06T19:00:00.000Z',
        end_at: '2027-03-06T20:00:00.000Z',
        data: { location: 'Smile Clinic', reminder_minutes: 'none', source: 'import' },
      }),
    );
    d.close();
    const user = userEvent.setup();
    renderEditor(item);
    expect(await screen.findByLabelText('Reminder')).toHaveValue('none');
    await user.selectOptions(screen.getByLabelText('Reminder'), '');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await items())[0]?.data).toEqual({ location: 'Smile Clinic', source: 'import' }),
    );
  });
});
