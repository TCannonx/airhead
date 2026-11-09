import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import { updateSettingsData } from '../../lib/db/settings';
import type { Item } from '../../lib/schemas/records';
import EventEditor, { type EventDraft } from './EventEditor';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderEditor(item?: Item, extra: Partial<EventDraft> = {}) {
  render(
    <MemoryRouter>
      <AuthProvider services={localServices()}>
        <DataProvider userId={U}>
          <EventEditor
            draft={{
              item,
              start: new Date('2027-03-06T19:00:00Z'),
              end: new Date('2027-03-06T20:00:00Z'),
              allDay: false,
              ...extra,
            }}
            onClose={() => {}}
          />
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
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

describe('prep reminders in the editor', () => {
  it('a matching event shows its standing prep reminder, live as the title changes', async () => {
    const d = db();
    await updateSettingsData(d, U, {
      work: {
        prep_rules: [
          {
            id: 'r1',
            match: ['barber', 'haircut'],
            reminder: 'Bring €20 cash',
            minutes_before: 720,
          },
        ],
      },
    });
    d.close();
    const user = userEvent.setup();
    renderEditor();
    const title = await screen.findByLabelText('Title');
    await user.type(title, 'Dentist');
    expect(screen.queryByText(/Before this:/)).not.toBeInTheDocument();
    await user.clear(title);
    await user.type(title, 'Barber');
    expect(
      await screen.findByText('Before this: Bring €20 cash (12 h before)'),
    ).toBeInTheDocument();
  });
});

describe('repeat, ends, calendar in the editor (Task 11.4)', () => {
  it('weekly on chosen days, every 2 weeks, after 6 times, with the rule in words', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(await screen.findByLabelText('Title'), 'Swim');
    await user.selectOptions(screen.getByLabelText('Repeats'), 'FREQ=WEEKLY');
    const days = screen.getByRole('group', { name: 'On days' });
    // 6 March 2027 is a Saturday: that day is chosen to start with.
    expect(within(days).getByRole('button', { name: 'Sat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(days).getByRole('button', { name: 'Sat' }));
    await user.click(within(days).getByRole('button', { name: 'Thu' }));
    await user.click(within(days).getByRole('button', { name: 'Mon' }));
    const every = screen.getByLabelText('Every');
    await user.clear(every);
    await user.type(every, '2');
    await user.selectOptions(screen.getByLabelText('End repeat'), 'after');
    const times = screen.getByLabelText('Times');
    await user.clear(times);
    await user.type(times, '6');
    await user.selectOptions(screen.getByLabelText('Calendar'), 'us');
    expect(screen.getByTestId('repeat-summary')).toHaveTextContent(
      'Every 2 weeks on Mon and Thu, 6 times',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await items())[0]).toMatchObject({
        title: 'Swim',
        calendar: 'us',
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6',
      }),
    );
  });

  it('ends on a date', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(await screen.findByLabelText('Title'), 'Yoga');
    await user.selectOptions(screen.getByLabelText('Repeats'), 'FREQ=DAILY');
    await user.selectOptions(screen.getByLabelText('End repeat'), 'on');
    await user.clear(screen.getByLabelText('End date'));
    await user.type(screen.getByLabelText('End date'), '2027-03-20');
    expect(screen.getByTestId('repeat-summary')).toHaveTextContent('Every day until 20 Mar 2027');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await items())[0]?.rrule).toBe('FREQ=DAILY;UNTIL=20270320T235959Z'),
    );
  });

  it("quick add's More options opens with its title and repeat", async () => {
    renderEditor(undefined, { title: 'Quiz', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    expect(await screen.findByLabelText('Title')).toHaveValue('Quiz');
    expect(screen.getByLabelText('Repeats')).toHaveValue('FREQ=WEEKLY');
    expect(screen.getByTestId('repeat-summary')).toHaveTextContent('Every Thursday');
  });

  it('a rule the form cannot show is kept as it was', async () => {
    const d = db();
    const item = await save(
      d,
      'items',
      newItem(U, {
        type: 'event',
        title: 'Stand-up',
        start_at: '2027-03-06T09:00:00.000Z',
        rrule: 'FREQ=HOURLY;INTERVAL=8',
      }),
    );
    d.close();
    const user = userEvent.setup();
    renderEditor(item);
    expect(await screen.findByLabelText('Repeats')).toHaveValue('custom');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await items())[0]?.rrule).toBe('FREQ=HOURLY;INTERVAL=8'));
  });
});
