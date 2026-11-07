import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { AskService, Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string, services: Services) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return router;
}

function fakeAsk(itemId: string) {
  const questions: string[] = [];
  const service: AskService = {
    ask: (q) => {
      questions.push(q);
      return Promise.resolve({
        ok: true,
        error_code: null,
        message: 'Answered.',
        answer: 'Travel is cut by ten percent.',
        sources: [{ n: 1, item_id: itemId, title: 'Budget review', type: 'idea' }],
      });
    },
  };
  return { service, questions };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('Ask Airhead (Task 7.10)', () => {
  it('answers a question with citations that open the source', async () => {
    const d = db();
    const item = await save(d, 'items', newItem(U, { type: 'idea', title: 'Budget review' }));
    d.close();
    const { service, questions } = fakeAsk(item.id);
    const router = renderAt('/library', { ...localServices(), ask: service });
    const user = userEvent.setup();
    expect(await screen.findByText(/One AI call, ≈ €0\.002/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Question'), 'What happened to travel?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Travel is cut by ten percent.')).toBeInTheDocument();
    expect(questions).toEqual(['What happened to travel?']);
    await user.click(screen.getByRole('link', { name: '[1] Budget review' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/library/item/${item.id}`));
  });

  it('the thorough model can be chosen and is remembered (synced setting)', async () => {
    renderAt('/library', { ...localServices(), ask: fakeAsk('x').service });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Answer with/), 'large');
    expect(await screen.findByText(/One AI call, ≈ €0\.01/)).toBeInTheDocument();
    const d = db();
    expect((await d.settings.get(U))?.data.ask_model).toBe('large');
    d.close();
  });

  it('offline it points to search; local mode explains the server is needed', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderAt('/library', { ...localServices(), ask: fakeAsk('x').service });
    expect(await screen.findByText(/search below works offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });
});
