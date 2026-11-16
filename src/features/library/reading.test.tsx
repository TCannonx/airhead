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

  it('shows the enrichment: kind, minutes, source, summary, key points, why saved, topics (Task 16.3)', () => {
    render(
      <ReadingDetails
        item={newItem(U, {
          type: 'reading',
          title: 'Marathon plan',
          data: {
            url: 'https://example.com/plan',
            link: {
              status: 'read',
              reason: null,
              source: 'example.com',
              kind: 'article',
              minutes: 13,
              summary: 'A 16-week plan.',
              key_points: ['Protect the long run'],
              why_saved: 'For the spring marathon',
              topics: ['Marathon training'],
            },
          },
        })}
      />,
    );
    const box = screen.getByRole('region', { name: 'About this link' });
    expect(box).toHaveTextContent('Article · 13 min · Marathon training · example.com');
    expect(box).toHaveTextContent('A 16-week plan.');
    expect(screen.getByRole('list', { name: 'Key points' })).toHaveTextContent(
      'Protect the long run',
    );
    expect(box).toHaveTextContent('Why you saved it: For the spring marathon');
    expect(box).toHaveTextContent('Topics: Marathon training');
  });

  it('an unreadable link shows its reason and Open anyway (Task 16.3)', () => {
    render(
      <ReadingDetails
        item={newItem(U, {
          type: 'reading',
          title: 'Members only',
          data: {
            url: 'https://paper.example/a',
            link: {
              status: 'unreadable',
              reason: 'needs sign-in',
              source: 'paper.example',
              key_points: [],
              topics: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByText(/Couldn.t read this page: needs sign-in/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open anyway' })).toHaveAttribute(
      'href',
      'https://paper.example/a',
    );
  });
});
