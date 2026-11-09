import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { localDate, localMidnight } from '../../lib/calendar/sources';
import { addDays } from '../../lib/holidays/easter';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newItem, save } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';
import { deviceTimeZone } from './useCalendarData';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const tz = deviceTimeZone();
const today = localDate(new Date(), tz);
const at = (day: string, h: number) =>
  new Date(Date.parse(localMidnight(day, tz)) + h * 3_600_000).toISOString();

const QUIZ = '11111111-1111-4111-8111-000000000001';
const TRAINING = '11111111-1111-4111-8111-000000000003';

async function seed(extra: (d: ReturnType<typeof db>) => Promise<void> = async () => {}) {
  const d = db();
  const ev = (fields: Partial<Item> & Pick<Item, 'title'>) =>
    save(d, 'items', newItem(U, { type: 'event', calendar: 'personal', ...fields }));
  await ev({
    id: QUIZ,
    title: 'Quiz',
    start_at: at(addDays(today, 1), 20),
    end_at: at(addDays(today, 1), 23),
    rrule: 'FREQ=WEEKLY',
    body: 'Bring a pen',
    data: { location: 'The Local', reminder_minutes: '60' },
  });
  await ev({
    title: 'Niamh’s Birthday',
    all_day: true,
    start_at: localMidnight(addDays(today, 2), tz),
    rrule: 'FREQ=YEARLY',
  });
  await ev({
    id: TRAINING,
    title: 'Training',
    all_day: true,
    start_at: localMidnight(addDays(today, 3), tz),
  });
  await ev({ title: 'Dentist', start_at: at(addDays(today, -100), 9) });
  await extra(d);
  d.close();
}

function renderCalendar(width = 390) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  return render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/calendar'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const firstQuiz = async () => {
  const [first] = await screen.findAllByRole('button', { name: /Quiz/ });
  if (!first) throw new Error('no Quiz row');
  return first;
};

const item = async (id: string) => {
  const d = db();
  const i = await d.items.get(id);
  d.close();
  return i;
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('agenda (Task 11.6)', () => {
  it('lists the next days under day headers, with times, all-day and repeat marks', async () => {
    await seed();
    renderCalendar();
    const agenda = await screen.findByRole('region', { name: 'Agenda' });
    const tomorrow = await within(agenda).findByRole('region', { name: 'Tomorrow' });
    const quiz = within(tomorrow).getByRole('button', { name: /Quiz/ });
    expect(quiz).toHaveTextContent('20:00');
    expect(quiz).toHaveTextContent('23:00');
    expect(quiz).toHaveAccessibleName(/Every \w+day/);
    expect(quiz).toHaveTextContent('The Local');
    const birthday = within(agenda).getByRole('button', { name: /Niamh’s Birthday/ });
    expect(birthday).toHaveTextContent('All day');
    // The past event is not in the agenda.
    expect(within(agenda).queryByText('Dentist')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Agenda', checked: true })).toBeInTheDocument();
  });

  it('says so when there is nothing coming up', async () => {
    renderCalendar();
    expect(await screen.findByText('Nothing in the next 30 days')).toBeInTheDocument();
  });
});

const allItems = async () => {
  const d = db();
  const all = await d.items.toArray();
  d.close();
  return all;
};

describe('repeating events: this one, this and following, all (Task 11.5)', () => {
  it('Delete asks which; "This event" removes only that occurrence', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await firstQuiz());
    const sheet = await screen.findByRole('dialog', { name: 'Quiz' });
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }));
    const choice = within(sheet).getByRole('group', { name: 'Delete this repeating event?' });
    expect(
      within(choice)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancel', 'This event', 'This and following', 'All events']);
    await user.click(within(choice).getByRole('button', { name: 'This event' }));
    const first = at(addDays(today, 1), 20);
    await waitFor(async () => expect((await item(QUIZ))?.data.exdates).toEqual([first]));
    expect((await item(QUIZ))?.deleted_at).toBeNull();
    const agenda = await screen.findByRole('region', { name: 'Agenda' });
    // Tomorrow had only the quiz: the day is gone from the agenda; next week's is there.
    await waitFor(() =>
      expect(within(agenda).queryByRole('region', { name: 'Tomorrow' })).not.toBeInTheDocument(),
    );
    expect(within(agenda).getAllByRole('button', { name: /Quiz/ }).length).toBeGreaterThan(0);
  });

  it('editing one occurrence asks which; "This event" makes a one-off linked to the series', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await firstQuiz());
    const sheet = await screen.findByRole('dialog', { name: 'Quiz' });
    await user.click(within(sheet).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit event' });
    const title = within(form).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Quiz final');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    const choice = within(form).getByRole('group', { name: 'Save for which events?' });
    await user.click(within(choice).getByRole('button', { name: 'This event' }));
    await waitFor(async () =>
      expect((await allItems()).find((i) => i.title === 'Quiz final')).toMatchObject({
        rrule: null,
        start_at: at(addDays(today, 1), 20),
        data: {
          location: 'The Local',
          reminder_minutes: '60',
          parent_id: QUIZ,
          recurrence_id: at(addDays(today, 1), 20),
        },
      }),
    );
    expect((await item(QUIZ))?.title).toBe('Quiz');
  });

  it('a changed repeat cannot apply to one event only', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await firstQuiz());
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Quiz' })).getByRole('button', {
        name: 'Edit',
      }),
    );
    const form = await screen.findByRole('form', { name: 'Edit event' });
    await user.selectOptions(within(form).getByLabelText('Repeats'), 'FREQ=DAILY');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    const choice = within(form).getByRole('group', { name: 'Save for which events?' });
    expect(within(choice).queryByRole('button', { name: 'This event' })).not.toBeInTheDocument();
    await user.click(within(choice).getByRole('button', { name: 'All events' }));
    await waitFor(async () => expect((await item(QUIZ))?.rrule).toBe('FREQ=DAILY'));
  });
});

describe('event details (Task 11.3)', () => {
  it('tapping an event shows the read view first; Edit is one tap further', async () => {
    await seed(async (d) => {
      const { updateSettingsData } = await import('../../lib/db/settings');
      await updateSettingsData(d, U, {
        work: {
          prep_rules: [
            { id: 'r1', match: ['training'], reminder: 'Pack boots', minutes_before: 720 },
          ],
        },
      });
    });
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await firstQuiz());
    const sheet = await screen.findByRole('dialog', { name: 'Quiz' });
    expect(sheet).toHaveTextContent('20:00–23:00');
    expect(sheet).toHaveTextContent(/Every \w+day/);
    expect(sheet).toHaveTextContent('Personal');
    expect(sheet).toHaveTextContent('1 hour before');
    expect(sheet).toHaveTextContent('The Local');
    expect(sheet).toHaveTextContent('Bring a pen');
    expect(within(sheet).getByRole('button', { name: 'Start notes: Quiz' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit event' })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit event' });
    expect(within(form).getByLabelText('Title')).toHaveValue('Quiz');
    expect(screen.queryByRole('dialog', { name: 'Quiz' })).not.toBeInTheDocument();
  });

  it('shows prep reminders, and Delete asks first', async () => {
    await seed(async (d) => {
      const { updateSettingsData } = await import('../../lib/db/settings');
      await updateSettingsData(d, U, {
        work: {
          prep_rules: [
            { id: 'r1', match: ['training'], reminder: 'Pack boots', minutes_before: 720 },
          ],
        },
      });
    });
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await screen.findByRole('button', { name: /Training/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Training' });
    expect(sheet).toHaveTextContent('All day');
    expect(sheet).toHaveTextContent('Pack boots (12 h before)');
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }));
    expect(sheet).toHaveTextContent('Delete this event?');
    expect((await item(TRAINING))?.deleted_at).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await item(TRAINING))?.deleted_at).not.toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Send to Workshop from the details', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await firstQuiz());
    const sheet = await screen.findByRole('dialog', { name: 'Quiz' });
    await user.click(within(sheet).getByRole('button', { name: 'Send to Workshop' }));
    await waitFor(async () => expect((await item(QUIZ))?.data.workshop).toBe(true));
    expect(await within(sheet).findByRole('link', { name: 'In the Workshop' })).toBeInTheDocument();
  });

  it('a linked calendar event is read-only and says where it comes from', async () => {
    const feedId = '55555555-5555-4555-8555-555555555555';
    await seed(async (d) => {
      await d.feeds.put({
        ...baseRecord(U),
        id: feedId,
        kind: 'linked_in',
        name: 'Work',
        colour: '#0f766e',
        token_hash: null,
        url: 'https://example.test/c.ics',
        enabled: true,
        settings: {},
        last_fetched_at: null,
        last_error: null,
      });
      await d.external_events.put({
        ...baseRecord(U),
        feed_id: feedId,
        occurrence_key: 'k1',
        title: 'Standup',
        location: 'Room 4',
        description: null,
        start_at: at(addDays(today, 1), 9),
        end_at: at(addDays(today, 1), 10),
        all_day: false,
      });
    });
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await screen.findByRole('button', { name: /Standup/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Standup' });
    expect(sheet).toHaveTextContent('Work');
    expect(sheet).toHaveTextContent('Room 4');
    expect(sheet).toHaveTextContent('Read only');
    expect(within(sheet).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('search (Task 11.6)', () => {
  it('finds past and future events by title as you type; a result opens its details', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.type(await screen.findByRole('searchbox', { name: 'Search events' }), 'den');
    const results = await screen.findByRole('region', { name: 'Search results' });
    const past = within(results).getByRole('region', { name: 'Past' });
    await user.click(within(past).getByRole('button', { name: /Dentist/ }));
    expect(await screen.findByRole('dialog', { name: 'Dentist' })).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    await seed();
    const user = userEvent.setup();
    renderCalendar();
    await user.type(await screen.findByRole('searchbox', { name: 'Search events' }), 'zzz');
    expect(await screen.findByText('No events found')).toBeInTheDocument();
  });
});

describe('calendars and views are remembered on this device (Task 11.6)', () => {
  it('a hidden calendar stays hidden after a reload, with a visible way back', async () => {
    await seed();
    const user = userEvent.setup();
    const first = renderCalendar();
    await screen.findAllByRole('button', { name: /Quiz/ });
    await user.click(screen.getByRole('button', { name: 'Calendars' }));
    const sheet = await screen.findByRole('dialog', { name: 'Calendars' });
    await user.click(within(sheet).getByRole('switch', { name: 'Personal' }));
    expect(within(sheet).getByRole('switch', { name: 'Personal' })).not.toBeChecked();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /Quiz/ })).toHaveLength(0));
    expect(screen.getByRole('status')).toHaveTextContent('Personal is hidden.');
    first.unmount();

    renderCalendar();
    expect(await screen.findByText('Personal is hidden.')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Quiz/ })).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect((await screen.findAllByRole('button', { name: /Quiz/ })).length).toBeGreaterThan(0);
    expect(localStorage.getItem('airhead.calendar.hidden')).toBe('[]');
  });

  it('the chosen view is remembered; the phone month shows dots and the day’s list', async () => {
    await seed();
    const user = userEvent.setup();
    const first = renderCalendar();
    await user.click(await screen.findByRole('radio', { name: 'Month' }));
    expect(localStorage.getItem('airhead.calendar.view')).toBe('month');
    first.unmount();

    renderCalendar();
    expect(await screen.findByRole('radio', { name: 'Month', checked: true })).toBeInTheDocument();
    await screen.findByRole('grid', { name: 'Month' });
    const day = addDays(today, 3);
    // Pick the training day (it may be next month: go there first).
    if (day.slice(0, 7) !== today.slice(0, 7))
      await user.click(screen.getByRole('button', { name: 'Next' }));
    const grid = await screen.findByRole('grid', { name: 'Month' });
    const cell = await waitFor(() => {
      const el = grid.querySelector<HTMLElement>(`[data-day="${day}"]`);
      if (!el) throw new Error('no cell');
      return el;
    });
    expect(cell).toHaveAccessibleName(/1 event/);
    expect(within(cell).getAllByTestId('day-dot')).toHaveLength(1);
    await user.click(cell);
    const list = await screen.findByRole('region', { name: /^Events on / });
    expect(within(list).getByRole('button', { name: /Training/ })).toBeInTheDocument();
  });
});
