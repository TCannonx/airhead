import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import NotificationSettings from './NotificationSettings';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const SUB = { endpoint: 'https://push.test/x', keys: { auth: 'a', p256dh: 'p' } };

function renderIt(services: Services) {
  render(
    <MemoryRouter>
      <AuthProvider services={services}>
        <DataProvider userId={U}>
          <NotificationSettings standalone />
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const pushService = () => ({
  publicKey: vi.fn(() => Promise.resolve('AQID_w')),
  sendTest: vi.fn(() =>
    Promise.resolve({ ok: true, message: 'Sent. It should arrive in a few seconds.' }),
  ),
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  const subscription = { toJSON: () => SUB, unsubscribe: vi.fn(() => Promise.resolve(true)) };
  vi.stubGlobal('Notification', { requestPermission: vi.fn(() => Promise.resolve('granted')) });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: () => Promise.resolve(null),
          subscribe: vi.fn(() => Promise.resolve(subscription)),
        },
      }),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings → Notifications (Task 4.11)', () => {
  it('asks for permission only on tap, saves the subscription and sends a test', async () => {
    const push = pushService();
    const user = userEvent.setup();
    renderIt({ ...localServices(), push });
    expect(await screen.findByText('Notifications are off on all devices.')).toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText('This device gets notifications.')).toBeInTheDocument();
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    const d = db();
    const [device] = await d.devices.toArray();
    d.close();
    expect(device?.push_subscription).toEqual(SUB);

    await user.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(await screen.findByText(/Sent\. It should arrive/)).toBeInTheDocument();
    expect(push.sendTest).toHaveBeenCalledWith(device?.id);

    // Per-device switch.
    const sw = screen.getByRole('switch', { name: `Notifications on ${device?.name ?? ''}` });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    expect(await screen.findByText('Notifications are off on all devices.')).toBeInTheDocument();
  });

  it('saves preferences: types, quiet hours, cap and the reminder default', async () => {
    const user = userEvent.setup();
    renderIt({ ...localServices(), push: pushService() });
    const form = await screen.findByRole('form', { name: 'Notification preferences' });
    await user.click(within(form).getByLabelText('Tasks that keep slipping'));
    const start = within(form).getByLabelText('Quiet hours start');
    await user.clear(start);
    await user.type(start, '23:00');
    await user.clear(within(form).getByLabelText('Most notifications a day'));
    await user.type(within(form).getByLabelText('Most notifications a day'), '5');
    await user.selectOptions(within(form).getByLabelText('Event reminders by default'), '15');
    await user.click(within(form).getByRole('button', { name: 'Save notification settings' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const d = db();
    const settings = await d.settings.get(U);
    d.close();
    expect(settings?.data.notifications).toMatchObject({
      quiet_start: '23:00',
      daily_cap: 5,
      event_reminder_minutes: 15,
      types: { slip: false, event_reminder: true },
    });
  });

  it('explains a refused permission', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn(() => Promise.resolve('denied')) });
    const user = userEvent.setup();
    renderIt({ ...localServices(), push: pushService() });
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText(/Notifications are blocked for Airhead/)).toBeInTheDocument();
  });

  it('without a server it says so', async () => {
    renderIt(localServices());
    expect(await screen.findByText(/Needs a server/)).toBeInTheDocument();
  });
});
