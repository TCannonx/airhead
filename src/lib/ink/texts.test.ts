import { describe, expect, it } from 'vitest';
import { addText, editText, moveText, removeText, withoutEmpty } from './texts';

describe('text boxes (Task 6.6)', () => {
  it('add, edit, move and remove, kept inside the page', () => {
    let t = addText([], 100, 200, 1400, 'a');
    expect(t).toEqual([{ id: 'a', x: 100, y: 200, text: '' }]);
    t = editText(t, 'a', 'Action: book room');
    t = moveText(t, 'a', 2000, -50, 1400);
    expect(t).toEqual([{ id: 'a', x: 960, y: 0, text: 'Action: book room' }]);
    t = addText(t, 10, 5000, 1400, 'b');
    expect(t[1]).toMatchObject({ id: 'b', y: 1370 });
    expect(removeText(t, 'a').map((x) => x.id)).toEqual(['b']);
  });

  it('drops boxes nobody typed in', () => {
    const t = editText(addText(addText([], 0, 0, 1400, 'a'), 0, 50, 1400, 'b'), 'b', 'kept');
    expect(withoutEmpty(t).map((x) => x.id)).toEqual(['b']);
  });
});
