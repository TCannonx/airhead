import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_SIDE } from './image';

describe('fitWithin', () => {
  it('shrinks so the longest side is 1600 px, keeping the shape', () => {
    expect(MAX_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('rounds and never returns zero', () => {
    expect(fitWithin(10000, 3)).toEqual({ width: 1600, height: 1 });
  });
});
