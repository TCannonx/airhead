import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { localServices } from '../../lib/auth/localAuth';
import type { CaptureTokensService } from '../../lib/auth/types';
import { hashToken, newTokenValue, type CaptureTokenRow } from '../../lib/capture/tokens';
import CaptureTokens from './CaptureTokens';

function fakeTokens() {
  const rows: CaptureTokenRow[] = [];
  const hashes: string[] = [];
  const service: CaptureTokensService = {
    list: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    create: async (label) => {
      const token = newTokenValue();
      hashes.push(await hashToken(token));
      rows.unshift({
        id: `t${rows.length + 1}`,
        label,
        created_at: '2026-07-15T10:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
      });
      return token;
    },
    revoke: (id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.revoked_at = '2026-07-15T11:00:00.000Z';
      return Promise.resolve();
    },
  };
  return { service, rows, hashes };
}

describe('capture tokens (Task 7.1)', () => {
  it('tokens are random, prefixed, and stored only as a sha-256 hash', async () => {
    const a = newTokenValue();
    expect(a).toMatch(/^ah_[A-Za-z0-9_-]{43}$/);
    expect(newTokenValue()).not.toBe(a);
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('creates a token (shown once), lists it, and revokes it', async () => {
    const { service, hashes } = fakeTokens();
    const user = userEvent.setup();
    render(
      <AuthProvider services={{ ...localServices(), captureTokens: service }}>
        <CaptureTokens />
      </AuthProvider>,
    );
    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Shortcut');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    const alert = await screen.findByRole('alert');
    const shown = alert.querySelector('code')?.textContent ?? '';
    expect(shown).toMatch(/^ah_/);
    expect(hashes).toEqual([await hashToken(shown)]);
    expect(await screen.findByText('Last used: never')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(shown)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Revoke Shortcut' }));
    await waitFor(() => expect(screen.getByText(/^Revoked /)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
  });

  it('local mode explains that a server is needed', () => {
    render(
      <AuthProvider services={localServices()}>
        <CaptureTokens />
      </AuthProvider>,
    );
    expect(screen.getByText(/needs Airhead/)).toBeInTheDocument();
  });
});
