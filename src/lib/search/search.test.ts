import { describe, expect, it } from 'vitest';
import { newCapture, newItem } from '../db/repository';
import { SearchIndex } from './index';

const U = '11111111-1111-4111-8111-111111111111';

describe('SearchIndex', () => {
  it('finds items by title and body, and captures by text', () => {
    const idx = new SearchIndex();
    const a = newItem(U, { type: 'idea', title: 'Raised garden beds', body: 'cedar planks' });
    const b = newItem(U, { type: 'note', title: 'Shed', body: 'needs a new roof' });
    const c = newCapture(U, { text: 'ring the plumber about the boiler' });
    idx.sync([a, b], [c]);

    expect(idx.search('garden').map((r) => r.id)).toEqual([a.id]);
    expect(idx.search('roof').map((r) => r.id)).toEqual([b.id]);
    expect(idx.search('boiler')).toEqual([
      expect.objectContaining({
        kind: 'capture',
        id: c.id,
        title: 'ring the plumber about the boiler',
      }),
    ]);
  });

  it('matches word prefixes and small typos', () => {
    const idx = new SearchIndex();
    const a = newItem(U, { type: 'reading', title: 'Composting guide' });
    idx.sync([a], []);
    expect(idx.search('compo').map((r) => r.id)).toEqual([a.id]);
    expect(idx.search('compsting').map((r) => r.id)).toEqual([a.id]);
  });

  it('updates incrementally: changed rows re-indexed, removed and deleted rows dropped', () => {
    const idx = new SearchIndex();
    const a = newItem(U, { type: 'note', title: 'Alpha' });
    const b = newItem(U, { type: 'note', title: 'Bravo' });
    idx.sync([a, b], []);
    expect(idx.size).toBe(2);

    const a2 = { ...a, title: 'Charlie', updated_at: '2099-01-01T00:00:00.000Z' };
    const changed = idx.sync([a2, { ...b, deleted_at: '2026-11-07T00:00:00.000Z' }], []);
    expect(changed).toEqual({ added: 0, updated: 1, removed: 1 });
    expect(idx.search('alpha')).toEqual([]);
    expect(idx.search('charlie').map((r) => r.id)).toEqual([a.id]);
    expect(idx.search('bravo')).toEqual([]);

    // Nothing changed: nothing re-indexed.
    expect(idx.sync([a2], [])).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('leaves out dropped items and returns nothing for an empty query', () => {
    const idx = new SearchIndex();
    idx.sync([newItem(U, { type: 'event', title: 'Dropped thing', status: 'dropped' })], []);
    expect(idx.search('dropped')).toEqual([]);
    expect(idx.search('   ')).toEqual([]);
  });
});
