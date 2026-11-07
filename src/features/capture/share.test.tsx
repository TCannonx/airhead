import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { bookmarkletHref, sharedText, shareUrl } from '../../lib/capture/bookmarklet';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';
import BookmarkletLink from '../settings/BookmarkletLink';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const captures = async () => {
  const d = db();
  const all = await d.captures.toArray();
  d.close();
  return all;
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('bookmarklet and share target (Task 7.4)', () => {
  it('the bookmarklet opens Airhead’s /share with the page details and carries no token', () => {
    const href = bookmarkletHref('https://airhead.example/');
    expect(href.startsWith('javascript:')).toBe(true);
    const code = decodeURIComponent(href.slice('javascript:'.length));
    expect(code).toContain('"https://airhead.example/share?"');
    expect(code).toContain('location.href');
    expect(code).toContain('document.title');
    expect(code).toContain('getSelection()');
    expect(code).not.toMatch(/ah_|fetch|Authorization/);
    // It is valid JavaScript.
    expect(() => new Function(code)).not.toThrow();
  });

  it('encodes the selection, the title and the address', () => {
    const url = new URL(
      shareUrl('https://airhead.example', {
        url: 'https://news.example/a?b=1&c=2',
        title: 'Rain & sun',
        selection: 'x'.repeat(5000),
      }),
    );
    expect(url.pathname).toBe('/share');
    expect(url.searchParams.get('url')).toBe('https://news.example/a?b=1&c=2');
    expect(url.searchParams.get('title')).toBe('Rain & sun');
    expect(url.searchParams.get('text')).toHaveLength(4000);
    expect(sharedText({ title: 'Rain', text: 'it pours' })).toBe('Rain\n“it pours”');
    expect(sharedText({ title: 'Rain', text: '' })).toBe('Rain');
  });

  it('/share saves the page once as a link capture and says so', async () => {
    renderAt('/share?url=https%3A%2F%2Fnews.example%2Fa&title=Rain%20today&text=');
    expect(await screen.findByText('Saved to Airhead.')).toBeInTheDocument();
    await waitFor(async () => expect(await captures()).toHaveLength(1));
    const [c] = await captures();
    expect(c).toMatchObject({ kind: 'link', url: 'https://news.example/a', text: 'Rain today' });
  });

  it('/share with nothing shared saves nothing', async () => {
    renderAt('/share');
    expect(await screen.findByText(/Nothing to save/)).toBeInTheDocument();
    expect(await captures()).toEqual([]);
  });

  it('Settings offers the bookmarklet as a draggable link', async () => {
    render(<BookmarkletLink origin="https://airhead.example" />);
    const link = screen.getByText('Send to Airhead');
    await waitFor(() => expect(link.getAttribute('href')).toMatch(/^javascript:/));
    expect(link).toHaveAttribute('draggable', 'true');
  });
});
