import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newItem, save } from '../../lib/db/repository';
import { pageItemSchema, pageSchema, topicSchema } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
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

async function seed() {
  const d = db();
  const run = await save(
    d,
    'topics',
    topicSchema.parse({ ...baseRecord(U), name: 'Marathon training' }),
  );
  const fit = await save(d, 'topics', topicSchema.parse({ ...baseRecord(U), name: 'Fitness' }));
  const small = await save(
    d,
    'topics',
    topicSchema.parse({ ...baseRecord(U), name: 'Two links only' }),
  );
  const links = [];
  for (const [n, t] of [
    ['Plan', run.id],
    ['Easy runs', run.id],
    ['Taper', run.id],
    ['Gym', fit.id],
    ['Stretching', fit.id],
    ['Yoga', fit.id],
    ['One', small.id],
    ['Two', small.id],
  ] as const) {
    links.push(
      await save(
        d,
        'items',
        newItem(U, {
          type: 'reading',
          title: n,
          topic_ids: [t],
          data: { url: `https://e.example/${n}` },
        }),
      ),
    );
  }
  const page = await save(
    d,
    'pages',
    pageSchema.parse({
      ...baseRecord(U),
      kind: 'topic',
      key: `topic:${run.id}`,
      name: 'Marathon training',
      summary: 'Three pieces on getting ready.',
      facts: [],
      status: 'active',
      item_count: 3,
      last_item_at: null,
      summary_stale: false,
      summarised_at: null,
      rebuild_requested_at: null,
      collation: {
        overlaps: ['The plan and Taper agree'],
        open_questions: ['Which race?'],
        next_step: 'Pick a date',
      },
    }),
  );
  await d.page_items.put(
    pageItemSchema.parse({
      ...baseRecord(U),
      page_id: page.id,
      item_id: links[0]?.id,
      note: 'The backbone plan',
    }),
  );
  d.close();
  return { run, fit, page };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Library → Topics (Task 16.6)', () => {
  it('lists topics with 3 or more links, with counts', async () => {
    await seed();
    renderAt('/library/topics');
    const list = await screen.findByRole('list', { name: 'Topics' });
    expect(list).toHaveTextContent('Marathon training');
    expect(list).toHaveTextContent('3 links');
    expect(list).toHaveTextContent('Fitness');
    expect(within(list).queryByText('Two links only')).toBeNull();
  });

  it('a topic shows its summary, each link with its note, overlaps, questions and next step', async () => {
    const { run } = await seed();
    renderAt(`/library/topics/${run.id}`);
    expect(await screen.findByText('Three pieces on getting ready.')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Links' })).toHaveTextContent('The backbone plan');
    expect(screen.getByRole('list', { name: 'Overlaps' })).toHaveTextContent(
      'The plan and Taper agree',
    );
    expect(screen.getByRole('list', { name: 'Open questions' })).toHaveTextContent('Which race?');
    expect(screen.getByText('Pick a date')).toBeVisible();
  });

  it('Collate, Rename, Send to Workshop and Merge', async () => {
    const { run, fit, page } = await seed();
    const user = userEvent.setup();
    const router = renderAt(`/library/topics/${run.id}`);
    await user.click(await screen.findByRole('button', { name: 'Collate' }));
    expect(await screen.findByText('Collating again tonight.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByLabelText('Topic name');
    await user.clear(name);
    await user.type(name, 'Spring marathon');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Spring marathon' })).toBeVisible();
    await waitFor(async () => {
      const d = db();
      const p = await d.pages.get(page.id);
      d.close();
      expect([p?.name, !!p?.rebuild_requested_at]).toEqual(['Spring marathon', true]);
    });

    await user.selectOptions(screen.getByLabelText('Merge with'), fit.id);
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/library/topics/${fit.id}`));
    const d = db();
    const fitItems = await d.items.filter((i) => i.topic_ids.includes(fit.id)).count();
    const gone = await d.topics.get(run.id);
    d.close();
    expect(fitItems).toBe(6);
    expect(gone?.deleted_at).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'Send to Workshop' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/workshop\//));
  });
});
