import { describe, expect, it } from 'vitest';
import { layoutFor } from './layout';

describe('layoutFor', () => {
  it.each([
    [320, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1024, 'tablet'],
    [1279, 'tablet'],
    [1280, 'desktop'],
    [1920, 'desktop'],
  ] as const)('%i px -> %s', (width, expected) => {
    expect(layoutFor(width)).toBe(expected);
  });
});
