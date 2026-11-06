import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('opens on the Capture screen with the Airhead name visible', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeInTheDocument();
    expect(screen.getAllByText('Airhead').length).toBeGreaterThan(0);
  });
});
