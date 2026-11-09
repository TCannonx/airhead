import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { captureChip } from '../../lib/db/captures';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote } from '../../lib/db/notes';
import { newCapture, newItem, save } from '../../lib/db/repository';
import { sendCaptureToWorkshop, workshopTitle } from '../../lib/db/workshop';
import { AppLockProvider } from '../applock/AppLockProvider';

// jsdom has no layout; ProseMirror asks for rectangles and hit-testing.
const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Element.prototype.getClientRects ??= rects;
Range.prototype.getClientRects ??= rects;
Range.prototype.getBoundingClientRect ??= () =>
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }) as DOMRect;
document.elementFromPoint ??= () => null;

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);

function renderAt(path: string) {
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

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Send to Workshop (Task 11.2)', () => {
  it('a capture without an item becomes a Workshop note, word for word; a second tap adds nothing', async () => {
    const d = db();
    const text = 'Garden shed ideas\nmaybe cedar, maybe a green roof.';
    const c = await save(d, 'captures', newCapture(U, { text }));
    const first = await sendCaptureToWorkshop(d, U, c.id);
    const again = await sendCaptureToWorkshop(d, U, c.id);
    expect(again?.id).toBe(first?.id);
    const items = await d.items.where('capture_id').equals(c.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'note',
      title: 'Garden shed ideas',
      body: text,
      data: { workshop: true, workshop_from: 'manual' },
    });
    const sent = await d.captures.get(c.id);
    expect(sent?.status).toBe('sorted');
    expect(sent?.payload.workshop_item_id).toBe(items[0]?.id);
    expect(sent && captureChip(sent)).toBe('Sent to Workshop');
    d.close();
  });

  it("uses the capture's own note or idea when sorting already made one", async () => {
    const d = db();
    const c = await save(d, 'captures', newCapture(U, { text: 'shed', status: 'sorted' }));
    const idea = await save(
      d,
      'items',
      newItem(U, { type: 'idea', title: 'Shed', capture_id: c.id }),
    );
    const sent = await sendCaptureToWorkshop(d, U, c.id);
    expect(sent?.id).toBe(idea.id);
    expect((await d.items.get(idea.id))?.data.workshop).toBe(true);
    expect(await d.items.count()).toBe(1);
    d.close();
  });

  it('chips: a leftover sent by sorting keeps what else sorting did', () => {
    const base = newCapture(U, { text: 'x', status: 'sorted' });
    expect(
      captureChip({ ...base, payload: { workshop_item_id: 'i', workshop_reason: 'leftover' } }),
    ).toBe('Sorted · Sent to Workshop');
    expect(
      captureChip({ ...base, payload: { workshop_item_id: 'i', workshop_reason: 'unmapped' } }),
    ).toBe('Sent to Workshop');
    expect(workshopTitle('  still need to plan.  ')).toBe('Still need to plan');
    expect(workshopTitle('x'.repeat(100))).toHaveLength(80);
  });

  it('the Capture page recent list has the button; the chip then says Sent to Workshop', async () => {
    const d = db();
    await save(d, 'captures', newCapture(U, { text: 'hmm the thing with the stuff' }));
    d.close();
    const user = userEvent.setup();
    renderAt('/capture');
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    await user.click(within(recent).getByRole('button', { name: 'Send to Workshop' }));
    expect(await within(recent).findByText('Sent to Workshop')).toBeVisible();
    expect(within(recent).queryByRole('button', { name: 'Send to Workshop' })).toBeNull();
    const x = db();
    expect(await x.items.filter((i) => i.data.workshop === true).count()).toBe(1);
    x.close();
  });

  it('the Inbox Unsorted card has the button; the capture moves to "To flesh out"', async () => {
    const d = db();
    await save(d, 'captures', newCapture(U, { text: 'plan the attic' }));
    d.close();
    const user = userEvent.setup();
    renderAt('/inbox');
    const unsorted = await screen.findByRole('list', { name: 'Unsorted' });
    await user.click(await within(unsorted).findByRole('button', { name: 'Send to Workshop' }));
    const flesh = await screen.findByRole('list', { name: 'To flesh out' });
    expect(await within(flesh).findByRole('link', { name: 'Plan the attic' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByText('Nothing waiting. Everything is sorted.')).toBeVisible(),
    );
  });

  it('the note page menu sends the note and takes it out again', async () => {
    const d = db();
    const { item } = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Plan' });
    d.close();
    const user = userEvent.setup();
    renderAt(`/notes/${item.id}`);
    await user.click(await screen.findByRole('button', { name: 'Send to Workshop' }));
    expect(await screen.findByRole('link', { name: 'Open in the Workshop' })).toBeVisible();
    const x = db();
    expect((await x.items.get(item.id))?.data.workshop).toBe(true);
    x.close();
    await user.click(screen.getByRole('button', { name: 'Take out of Workshop' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Open in the Workshop' })).toBeNull(),
    );
  });
});
