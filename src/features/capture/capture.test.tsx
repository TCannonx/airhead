import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';

vi.mock('../../lib/files/image', async (orig) => ({
  ...(await orig<typeof import('../../lib/files/image')>()),
  compressImage: vi.fn(async () => new Blob(['small'], { type: 'image/webp' })),
}));

function renderCapture(width = 1440) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const router = createMemoryRouter(routes, { initialEntries: ['/capture'] });
  return render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={LOCAL_USER_ID}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const db = () => openUserDb(LOCAL_USER_ID);

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});
afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error jsdom has no matchMedia; remove the test stub
  delete window.matchMedia;
});

describe('Capture tab', () => {
  it('focuses the capture box on open', async () => {
    renderCapture();
    await waitFor(() => expect(screen.getByLabelText('Capture')).toHaveFocus());
  });

  it('saves with Enter on desktop, clears the box and shows a chip', async () => {
    renderCapture();
    const box = await screen.findByLabelText('Capture');
    await userEvent.type(box, 'dentist tue 3pm{Enter}');

    await waitFor(() => expect(box).toHaveValue(''));
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    expect(await within(recent).findByText('dentist tue 3pm')).toBeVisible();
    expect(within(recent).getByText('Sorting soon')).toBeVisible();
    const saved = await db().captures.toArray();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: 'text',
      text: 'dentist tue 3pm',
      source: 'app',
      status: 'unsorted',
    });
    expect(
      await db()
        .outbox.where('row_id')
        .equals(saved[0]?.id ?? '')
        .count(),
    ).toBe(1);
  });

  it('Shift+Enter adds a new line instead of saving', async () => {
    renderCapture();
    const box = await screen.findByLabelText('Capture');
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box).toHaveValue('line one\nline two');
    expect(await db().captures.count()).toBe(0);
  });

  it('has a visible Save button (touch) and ignores empty captures', async () => {
    renderCapture(390);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Capture'), '   ');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Capture'), 'buy milk');
    await userEvent.click(save);
    await waitFor(async () => expect(await db().captures.count()).toBe(1));
  });

  it('on touch, Enter makes a new line (the Save button saves)', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: q.includes('coarse'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    renderCapture(390);
    const box = await screen.findByLabelText('Capture');
    await userEvent.type(box, 'a{Enter}b');
    expect(box).toHaveValue('a\nb');
    expect(await db().captures.count()).toBe(0);
  });

  it('Paste link reads the clipboard only on tap and saves a link to the reading list', async () => {
    const readText = vi.fn(async () => 'https://example.com/article');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    renderCapture();
    await screen.findByLabelText('Capture');
    expect(readText).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Paste link' }));
    expect(readText).toHaveBeenCalledOnce();
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    expect(await within(recent).findByText('Reading list')).toBeVisible();
    const [c] = await db().captures.toArray();
    expect(c).toMatchObject({ kind: 'link', url: 'https://example.com/article' });
  });

  it('Paste link with plain text on the clipboard puts it in the box instead', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => 'not a link' },
    });
    renderCapture();
    await userEvent.click(await screen.findByRole('button', { name: 'Paste link' }));
    expect(screen.getByLabelText('Capture')).toHaveValue('not a link');
    expect(await db().captures.count()).toBe(0);
  });

  it('attaches a photo: compressed on the device and queued for upload', async () => {
    renderCapture();
    const input = await screen.findByLabelText('Attach photo');
    await userEvent.type(screen.getByLabelText('Capture'), 'receipt');
    await userEvent.upload(input, new File(['big'], 'photo.jpg', { type: 'image/jpeg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db().captures.count()).toBe(1));
    const [c] = await db().captures.toArray();
    expect(c?.kind).toBe('image');
    expect(c?.text).toBe('receipt');
    const files = await db().files.toArray();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ capture_id: c?.id, uploaded: false, mime: 'image/webp' });
    expect((c?.payload as { files?: unknown[] }).files).toHaveLength(1);
  });
});
