import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ingestUrl } from '../../lib/capture/ingestUrl';
import ShortcutsGuide from './ShortcutsGuide';

const REAL_TOKEN = /ah_[A-Za-z0-9_-]{43}/;

describe('iOS Shortcuts guide (Task 7.3)', () => {
  it('the written guide names the function address and never holds a real token', () => {
    const doc = readFileSync('docs/SETUP-SHORTCUTS.md', 'utf8');
    expect(doc).toContain('/functions/v1/ingest-capture');
    expect(doc).toContain('Bearer <your token>');
    expect(doc).not.toMatch(REAL_TOKEN);
    expect(doc).toMatch(/Back Tap/);
    expect(doc).toMatch(/Show in Share Sheet/);
  });

  it('builds the address from the Supabase URL', () => {
    expect(ingestUrl('https://abc.supabase.co/')).toBe(
      'https://abc.supabase.co/functions/v1/ingest-capture',
    );
    expect(ingestUrl(undefined)).toContain('<your-project>');
  });

  it('the in-app guide shows this account’s address and both Shortcuts', async () => {
    render(<ShortcutsGuide url="https://abc.supabase.co/functions/v1/ingest-capture" />);
    await userEvent.setup().click(screen.getByText('Set up the iOS Shortcuts'));
    expect(screen.getByText('https://abc.supabase.co/functions/v1/ingest-capture')).toBeVisible();
    expect(screen.getByText(/Send to Airhead \(share sheet\)/)).toBeVisible();
    expect(screen.getByText(/Quick thought \(Back Tap/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(REAL_TOKEN);
  });
});
