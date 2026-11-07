import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote } from '../../lib/db/notes';
import { AppLockProvider } from '../applock/AppLockProvider';

// jsdom has no layout; ProseMirror asks for rectangles and hit-testing.
const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const rect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect;
Element.prototype.getClientRects ??= rects;
Range.prototype.getClientRects ??= rects;
Range.prototype.getBoundingClientRect ??= rect;
document.elementFromPoint ??= () => null;

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return router;
}

const docs = async () => {
  const d = db();
  const all = await d.note_docs.toArray();
  d.close();
  return all;
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('typed notes (Task 6.3)', () => {
  it('New note from the Library opens the editor; typing is saved after a pause', async () => {
    const user = userEvent.setup();
    const router = renderAt('/library');
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/notes\//));

    const editor = await screen.findByLabelText('Note');
    await user.click(editor);
    await user.type(editor, 'Agenda for Monday');
    await waitFor(
      async () => expect(String((await docs())[0]?.doc.html)).toContain('Agenda for Monday'),
      {
        timeout: 3000,
      },
    );
  });

  it('opens an existing note with its text, and the title can be renamed', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, {
      type: 'meeting',
      kind: 'typed',
      title: 'Team sync',
    });
    await d.note_docs.update(item.id, {
      doc: { html: '<h1>Decisions</h1><ul><li><p>Ship it</p></li></ul>' },
    });
    d.close();
    const user = userEvent.setup();
    renderAt(`/notes/${item.id}`);
    expect(await screen.findByRole('heading', { name: 'Decisions', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Meeting notes' })).toBeInTheDocument();

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Team sync 7 Nov');
    await user.tab();
    await waitFor(async () => {
      const x = db();
      expect((await x.items.get(item.id))?.title).toBe('Team sync 7 Nov');
      x.close();
    });
  });

  it('the toolbar formats text (a heading here)', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Plan' });
    d.close();
    const user = userEvent.setup();
    renderAt(`/notes/${item.id}`);
    const editor = await screen.findByLabelText('Note');
    await user.click(editor);
    await user.click(screen.getByRole('button', { name: 'Heading 1' }));
    expect(screen.getByRole('button', { name: 'Heading 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('a note opened from the Library item link goes to the editor', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Plan' });
    d.close();
    const router = renderAt(`/library/item/${item.id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${item.id}`));
  });
});
