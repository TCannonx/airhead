import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { localServices } from './lib/auth/localAuth';

describe('App', () => {
  it('opens on the Capture screen with the Airhead name visible', async () => {
    window.history.replaceState(null, '', '/');
    render(<App services={localServices()} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeInTheDocument();
    expect(screen.getAllByText('Airhead').length).toBeGreaterThan(0);
  });
});
