import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote, saveDoc } from '../../lib/db/notes';
import { update } from '../../lib/db/repository';
import { encodePoints } from '../../lib/ink/strokes';
import { docText, htmlText } from '../../lib/notes/summary';
import { SearchIndex } from '../../lib/search';
import { AppLockProvider } from '../applock/AppLockProvider';

const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Element.prototype.getClientRects ??= rects;
Range.prototype.getClientRects ??= rects;
document.elementFromPoint ??= () => null;

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const realUA = navigator.userAgent;

const SUMMARY = {
  transcription: 'Budget review: cut travel by ten percent',
  summary: 'Travel spending is cut.',
  decisions: ['Cut travel'],
  actions: [],
  at: '2026-07-15T10:00:00.000Z',
};

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

async function inkNote(summarised: boolean) {
  const d = db();
  const { item } = await createNote(d, U, DEVICE, {
    type: 'meeting',
    kind: 'ink',
    title: 'Budget',
  });
  await saveDoc(d, DEVICE, item.id, {
    width: 1000,
    pages: [
      {
        height: 1400,
        strokes: [
          {
            tool: 'pen',
            color: '#111827',
            width: 4,
            d: encodePoints([
              { x: 10, y: 10, p: 0.5 },
              { x: 80, y: 30, p: 0.5 },
            ]),
          },
        ],
        texts: [{ id: 't1', x: 50, y: 300, text: 'Quarterly figures' }],
      },
    ],
  });
  if (summarised) await update(d, 'items', item.id, { data: { ...item.data, summary: SUMMARY } });
  d.close();
  return item;
}

const setUA = (ua: string, touch: number) => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touch });
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});
afterEach(() => setUA(realUA, 0));

describe('notes in the Library (Task 6.9)', () => {
  it('note text: typed HTML and text boxes become plain text', () => {
    expect(htmlText('<h1>Plan</h1><ul><li><p>Buy &amp; fit</p></li></ul>')).toBe('Plan\nBuy & fit');
    expect(
      docText({ kind: 'ink', doc: { pages: [{ texts: [{ text: 'A' }, { text: 'B' }] }] } }),
    ).toBe('A\nB');
  });

  it('search covers titles, typed text, transcriptions and summaries', async () => {
    const d = db();
    const typed = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Garden' });
    await saveDoc(d, DEVICE, typed.item.id, { html: '<p>Plant the tulips</p>' });
    d.close();
    const ink = await inkNote(true);
    const d2 = db();
    const items = await d2.items.toArray();
    const docs = await d2.note_docs.toArray();
    d2.close();
    const idx = new SearchIndex();
    idx.sync(items, [], docs);
    expect(idx.search('tulips').map((r) => r.id)).toEqual([typed.item.id]);
    expect(idx.search('travel').map((r) => r.id)).toEqual([ink.id]);
    expect(idx.search('quarterly').map((r) => r.id)).toEqual([ink.id]);
    expect(idx.search('budget').map((r) => r.id)).toEqual([ink.id]);
    // Editing the document re-indexes the note.
    const d3 = db();
    await saveDoc(d3, DEVICE, typed.item.id, { html: '<p>Prune the roses</p>' });
    const docs2 = await d3.note_docs.toArray();
    d3.close();
    idx.sync(items, [], docs2);
    expect(idx.search('tulips')).toEqual([]);
    expect(idx.search('roses').map((r) => r.id)).toEqual([typed.item.id]);
  });

  it('Library search finds a typed note by its text and opens it', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, {
      type: 'note',
      kind: 'typed',
      title: 'Garden',
    });
    await saveDoc(d, DEVICE, item.id, { html: '<p>Plant the tulips</p>' });
    d.close();
    const router = renderAt('/library');
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'tulips');
    const results = await screen.findByRole('list', { name: 'Search results' });
    await user.click(await within(results).findByText('Garden'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${item.id}`));
  });

  it('a summarised handwritten note shows the summary above view-only pages on desktop', async () => {
    const item = await inkNote(true);
    renderAt(`/notes/${item.id}`);
    expect(await screen.findByText('Travel spending is cut.')).toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Handwritten page 1 (view only)' })).toBeInTheDocument();
    expect(screen.getByText('Quarterly figures')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eraser' })).toBeNull();
    const summary = screen.getByRole('region', { name: 'Summary' });
    const page = screen.getByRole('img', { name: /view only/ });
    expect(summary.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit pages' }));
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeInTheDocument();
  });

  it('on the iPad, or before summarising, pages stay editable', async () => {
    setUA(IPAD_UA, 5);
    const a = await inkNote(true);
    renderAt(`/notes/${a.id}`);
    expect(await screen.findByRole('button', { name: 'Eraser' })).toBeInTheDocument();
  });

  it('an unsummarised handwritten note is editable on desktop', async () => {
    const b = await inkNote(false);
    renderAt(`/notes/${b.id}`);
    expect(await screen.findByRole('button', { name: 'Eraser' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /view only/ })).toBeNull();
  });
});
