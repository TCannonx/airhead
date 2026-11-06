import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { localServices } from '../../lib/auth/localAuth';
import type { AppLockAuthenticator, Services } from '../../lib/auth/types';
import { saveLockConfig } from '../../lib/applock/lock';

function fakeAuthenticator(overrides: Partial<AppLockAuthenticator> = {}) {
  return {
    available: vi.fn(async () => true),
    register: vi.fn(async (_label: string) => 'new-cred'),
    verify: vi.fn(async (_id: string) => {}),
    ...overrides,
  } satisfies AppLockAuthenticator;
}

function services(appLock: AppLockAuthenticator): Services {
  return { ...localServices(), appLock };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  window.history.replaceState(null, '', '/');
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('app lock', () => {
  it('is off by default: the app opens straight away', async () => {
    render(<App services={services(fakeAuthenticator())} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  });

  it('shows the lock screen on open and unlocks with Face ID / Touch ID', async () => {
    saveLockConfig(localStorage, { enabled: true, credentialId: 'cred-1', timeoutMinutes: 5 });
    const auth = fakeAuthenticator();
    render(<App services={services(auth)} />);

    expect(await screen.findByRole('heading', { name: 'Airhead is locked' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: 'Capture' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));
    expect(auth.verify).toHaveBeenCalledWith('cred-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  });

  it('stays locked and says so when verification fails', async () => {
    saveLockConfig(localStorage, { enabled: true, credentialId: 'cred-1', timeoutMinutes: 5 });
    const auth = fakeAuthenticator({
      verify: vi.fn(async () => {
        throw new Error('Face ID was cancelled.');
      }),
    });
    render(<App services={services(auth)} />);
    await userEvent.click(await screen.findByRole('button', { name: /unlock/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Face ID was cancelled.');
    expect(screen.getByRole('heading', { name: 'Airhead is locked' })).toBeVisible();
  });

  it('locks again when the app returns after the time-out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    saveLockConfig(localStorage, { enabled: true, credentialId: 'cred-1', timeoutMinutes: 5 });
    render(<App services={services(fakeAuthenticator())} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: /unlock/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();

    act(() => setVisibility('hidden'));
    act(() => {
      vi.advanceTimersByTime(4 * 60_000);
      setVisibility('visible');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();

    act(() => setVisibility('hidden'));
    act(() => {
      vi.advanceTimersByTime(6 * 60_000);
      setVisibility('visible');
    });
    expect(screen.getByRole('heading', { name: 'Airhead is locked' })).toBeVisible();
  });

  it('is turned on and off in Settings', async () => {
    const auth = fakeAuthenticator();
    window.history.replaceState(null, '', '/settings');
    render(<App services={services(auth)} />);

    const toggle = await screen.findByRole('switch', { name: /app lock/i });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(auth.register).toHaveBeenCalledOnce();
    expect(toggle).toBeChecked();
    expect(JSON.parse(localStorage.getItem('airhead.appLock') ?? '{}')).toMatchObject({
      enabled: true,
      credentialId: 'new-cred',
    });

    await userEvent.selectOptions(screen.getByLabelText(/lock after/i), '15');
    expect(JSON.parse(localStorage.getItem('airhead.appLock') ?? '{}').timeoutMinutes).toBe(15);
    expect(screen.getByText(/privacy screen, not encryption/i)).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('airhead.appLock') ?? '{}').enabled).toBe(false);
  });

  it('explains when this device has no Face ID / Touch ID', async () => {
    window.history.replaceState(null, '', '/settings');
    render(<App services={services(fakeAuthenticator({ available: vi.fn(async () => false) }))} />);
    expect(await screen.findByText(/isn.t available on this device/i)).toBeVisible();
    expect(screen.getByRole('switch', { name: /app lock/i })).toBeDisabled();
  });
});
