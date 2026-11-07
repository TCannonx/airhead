import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newItem } from '../../lib/db/repository';
import ReadingDetails from './ReadingDetails';

const U = '11111111-1111-4111-8111-111111111111';

describe('ReadingDetails', () => {
  it('shows the summary, key points and reading time', () => {
    render(
      <ReadingDetails
        item={newItem(U, {
          type: 'reading',
          title: 'Compost',
          data: {
            summary: 'How to compost.',
            key_points: ['Keep it moist', 'Turn it'],
            reading_minutes: 4,
          },
        })}
      />,
    );
    expect(screen.getByText('How to compost.')).toBeVisible();
    expect(screen.getByText('Turn it')).toBeVisible();
    expect(screen.getByText('About 4 min read')).toBeVisible();
  });

  it('marks a page that could not be read, with its description', () => {
    render(
      <ReadingDetails
        item={newItem(U, {
          type: 'reading',
          title: 'Housing',
          data: { couldnt_read: true, description: 'What buyers can expect.' },
        })}
      />,
    );
    expect(screen.getByText(/Couldn.t read this page/)).toBeVisible();
    expect(screen.getByText('What buyers can expect.')).toBeVisible();
  });

  it('says it will be read soon before link reading has run', () => {
    render(
      <ReadingDetails
        item={newItem(U, { type: 'reading', title: 'x', data: { url: 'https://x' } })}
      />,
    );
    expect(screen.getByText(/read and summarised soon/)).toBeVisible();
  });

  it('shows nothing for other item types', () => {
    const { container } = render(
      <ReadingDetails item={newItem(U, { type: 'note', title: 'x' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
