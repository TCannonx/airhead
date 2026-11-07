import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import type { NotesService, Services, SummariseRequest } from '../../lib/auth/types';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote, saveDoc } from '../../lib/db/notes';
import { encodePoints, type InkDoc } from '../../lib/ink/strokes';
import { readSummary } from '../../lib/notes/summary';
import { SearchIndex } from '../../lib/search';
import { AppLockProvider } from '../applock/AppLockProvider';
import SummarisePanel from './SummarisePanel';

const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Element.prototype.getClientRects ??= rects;
Range.prototype.getClientRects ??= rects;
document.elementFromPoint ??= () => null;

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);

const RESULT = {
  transcription: null,
  summary: 'The launch moves to Friday.',
  decisions: ['Launch on Friday'],
  actions: [{ title: 'Book the room', owner: 'Mark', due_text: 'Thursday' }],
};

function fakeNotes(ok = true) {
  const calls: SummariseRequest[] = [];
  const notes: NotesService = {
    summarise: (req) => {
      calls.push(req);
      return Promise.resolve(
        ok
          ? { ok: true, error_code: null, message: 'Summarised.', result: RESULT, cost_eur: 0.02 }
          : { ok: false, error_code: 'cap_reached', message: 'This month’s AI budget is used up.' },
      );
    },
  };
  return { notes, calls };
}

function withServices(services: Services, ui: React.ReactNode) {
  return render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>{ui}</AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const itemNow = async (id: string) => {
  const d = db();
  const item = await d.items.get(id);
  d.close();
  return item;
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('Summarise (Task 6.7)', () => {
  it('typed meeting notes: sends the text with date and attendees, stores the result, adds it to search', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, {
      type: 'meeting',
      kind: 'typed',
      title: 'Team sync',
      data: { meeting_date: '2026-07-15', attendees: ['Mark'] },
    });
    await saveDoc(d, DEVICE, item.id, { html: '<p>Launch moves to Friday</p>' });
    d.close();
    const { notes, calls } = fakeNotes();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const router = createMemoryRouter(routes, { initialEntries: [`/notes/${item.id}`] });
    withServices({ ...localServices(), notes }, <RouterProvider router={router} />);

    const user = userEvent.setup();
    expect(await screen.findByText(/One AI call, ≈ €0\.02/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done → Summarise' }));

    expect(await screen.findByText('The launch moves to Friday.')).toBeInTheDocument();
    expect(screen.getByText('Launch on Friday')).toBeInTheDocument();
    expect(screen.getByText('(Mark, Thursday)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarise again' })).toBeInTheDocument();
    expect(calls).toEqual([
      {
        kind: 'typed',
        title: 'Team sync',
        date: '2026-07-15',
        attendees: ['Mark'],
        html: '<p>Launch moves to Friday</p>',
      },
    ]);
    const saved = await itemNow(item.id);
    expect(saved && readSummary(saved)?.decisions).toEqual(['Launch on Friday']);
    const idx = new SearchIndex();
    idx.sync(saved ? [saved] : [], []);
    expect(idx.search('room').map((r) => r.id)).toEqual([item.id]);
  });

  it('handwritten pages are sent as images; an empty page sends nothing', async () => {
    const d = db();
    const { item, doc } = await createNote(d, U, DEVICE, {
      type: 'note',
      kind: 'ink',
      title: 'Budget',
    });
    d.close();
    const { notes, calls } = fakeNotes();
    const renderPages = vi.fn((_doc: InkDoc) => Promise.resolve([] as string[]));
    const user = userEvent.setup();
    const view = withServices(
      { ...localServices(), notes },
      <SummarisePanel item={item} doc={doc} render={renderPages} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Done → Summarise' }));
    expect(await screen.findByText('Write something first.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    const inked = {
      ...doc,
      doc: {
        width: 1000,
        pages: [
          {
            height: 1400,
            strokes: [
              { tool: 'pen', color: '#000', width: 4, d: encodePoints([{ x: 1, y: 1, p: 0.5 }]) },
            ],
            texts: [],
          },
        ],
      },
    };
    renderPages.mockResolvedValue(['iVBORw0KGgo=']);
    view.rerender(
      <AuthProvider services={{ ...localServices(), notes }}>
        <DataProvider userId={U}>
          <AppLockProvider>
            <SummarisePanel item={item} doc={inked} render={renderPages} />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Done → Summarise' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ kind: 'ink', images: ['iVBORw0KGgo='], title: 'Budget' });
    expect(renderPages.mock.calls.at(-1)?.[0]).toMatchObject({ pages: [{ height: 1400 }] });
  });

  it('shows why it failed and stores nothing', async () => {
    const d = db();
    const { item, doc } = await createNote(d, U, DEVICE, {
      type: 'note',
      kind: 'typed',
      title: 'Plan',
    });
    d.close();
    const { notes } = fakeNotes(false);
    const user = userEvent.setup();
    withServices(
      { ...localServices(), notes },
      <SummarisePanel item={item} doc={{ ...doc, doc: { html: '<p>Hi</p>' } }} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Done → Summarise' }));
    expect(await screen.findByRole('status')).toHaveTextContent('AI budget is used up');
    expect((await itemNow(item.id))?.data.summary).toBeUndefined();
  });

  it('offline: the button is off and says why; local mode: no button', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const d = db();
    const { item, doc } = await createNote(d, U, DEVICE, {
      type: 'note',
      kind: 'typed',
      title: 'Plan',
    });
    d.close();
    const view = withServices(
      { ...localServices(), notes: fakeNotes().notes },
      <SummarisePanel item={item} doc={doc} />,
    );
    expect(await screen.findByRole('button', { name: 'Done → Summarise' })).toBeDisabled();
    expect(screen.getByText('Summarise needs a connection.')).toBeInTheDocument();
    view.unmount();
    withServices(localServices(), <SummarisePanel item={item} doc={doc} />);
    expect(await screen.findByText(/Summarise needs Airhead/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Summarise/ })).toBeNull();
  });
});
