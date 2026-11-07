import { describe, expect, it } from 'vitest';
import { clearInkClipboard, copyInk, PASTE_OFFSET, pasted, readInkClipboard } from './clipboard';
import { decodePoints, encodePoints, UndoStack, type StoredStroke } from './strokes';

const s: StoredStroke = {
  tool: 'pen',
  color: '#000',
  width: 4,
  d: encodePoints([
    { x: 10, y: 10, p: 0.5 },
    { x: 20, y: 20, p: 0.5 },
  ]),
};

describe('copy and paste (Task 9.3)', () => {
  it('copies a snapshot; paste is offset with new text box ids', () => {
    const box = { id: 'a', x: 100, y: 100, text: 'Agenda' };
    copyInk({ strokes: [s], texts: [box] });
    box.text = 'changed later';
    const c = readInkClipboard();
    expect(c?.texts[0]?.text).toBe('Agenda');
    if (!c) throw new Error('nothing copied');
    const p = pasted(c, () => 'new-id');
    expect(decodePoints(p.strokes[0]?.d ?? [])[0]).toMatchObject({
      x: 10 + PASTE_OFFSET,
      y: 10 + PASTE_OFFSET,
    });
    expect(p.texts).toEqual([{ id: 'new-id', x: 130, y: 130, text: 'Agenda' }]);
    clearInkClipboard();
    expect(readInkClipboard()).toBeNull();
  });

  it('a paste is one undo step', () => {
    const undo = new UndoStack();
    const after = undo.apply([s], { kind: 'paste', strokes: [s, s] });
    expect(after).toHaveLength(3);
    expect(undo.undo(after)).toHaveLength(1);
    expect(undo.redo([s])).toHaveLength(3);
  });
});
