import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addText,
  editText,
  moveText,
  removeText,
  TEXT_BOX_WIDTH,
  withoutEmpty,
} from '../../lib/ink/texts';
import {
  encodePoints,
  grownHeight,
  hits,
  PAGE_WIDTH,
  simplify,
  strokePath,
  UndoStack,
  type InkDoc,
  type InkPoint,
  type StoredStroke,
  type TextBox,
  type Tool,
} from '../../lib/ink/strokes';
import { copyInk, pasted, useInkClipboard } from '../../lib/ink/clipboard';
import {
  EMPTY_SELECTION,
  isEmpty,
  selectByLasso,
  clampMove,
  selectionBox,
  translateStroke,
  type Selection,
} from '../../lib/ink/selection';

export const INK_SAVE_DEBOUNCE_MS = 800;

const COLORS: [string, string][] = [
  ['#111827', 'Black'],
  ['#2563eb', 'Blue'],
  ['#dc2626', 'Red'],
  ['#15803d', 'Green'],
];
const WIDTHS: [number, string][] = [
  [3.5, 'Thin'],
  [7, 'Thick'],
];
const HIGHLIGHTER = { color: '#facc15', width: 18 };

const btn = (on: boolean) =>
  `rounded-md px-2 py-1 text-sm font-semibold ${
    on ? 'bg-slate-200 dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
  }`;

type Mode = Tool | 'eraser' | 'text' | 'lasso';

/**
 * A handwritten page (Task 6.5): fixed width, grows downwards as you write.
 * The Pencil (or a mouse) draws; a finger scrolls. Strokes are drawn with
 * perfect-freehand and stored as compact points.
 */
export default function InkCanvas({ doc, onSave }: { doc: InkDoc; onSave: (doc: InkDoc) => void }) {
  const page = doc.pages[0] ?? { height: 1400, strokes: [], texts: [] };
  const [strokes, setStrokes] = useState<StoredStroke[]>(page.strokes);
  const [height, setHeight] = useState(page.height);
  const [texts, setTexts] = useState<TextBox[]>(page.texts);
  const [focusId, setFocusId] = useState<string | null>(null);
  const moving = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [mode, setMode] = useState<Mode>('pen');
  const [color, setColor] = useState(COLORS[0]?.[0] ?? '#111827');
  const [width, setWidth] = useState(WIDTHS[0]?.[0] ?? 3.5);
  const [live, setLive] = useState<InkPoint[] | null>(null);
  // Lasso (Task 9.1): the loop being drawn, and what it caught.
  const [loop, setLoop] = useState<InkPoint[] | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  // Dragging a selection (Task 9.2): where it started, and the offset so far.
  const dragFrom = useRef<InkPoint | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const selBox = isEmpty(selection)
    ? null
    : selectionBox(strokes, texts, selection, TEXT_BOX_WIDTH);
  const pick = (m: Mode) => {
    setMode(m);
    setSelection(EMPTY_SELECTION);
  };
  // Mutable, but kept in state (not a ref) because render reads canUndo/canRedo.
  const [undo] = useState(() => new UndoStack());
  const svg = useRef<SVGSVGElement>(null);
  const drawing = useRef<InkPoint[] | null>(null);
  const fingerY = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<InkDoc | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) save.current(pending.current);
    },
    [],
  );

  const persist = (next: StoredStroke[], h: number, t: TextBox[] = texts) => {
    pending.current = {
      ...doc,
      pages: [{ ...page, height: h, strokes: next, texts: withoutEmpty(t) }],
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pending.current) save.current(pending.current);
      pending.current = null;
    }, INK_SAVE_DEBOUNCE_MS);
  };

  const toPage = (e: ReactPointerEvent): InkPoint => {
    const r = svg.current?.getBoundingClientRect();
    const scale = r && r.width > 0 ? PAGE_WIDTH / r.width : 1;
    return {
      x: (e.clientX - (r?.left ?? 0)) * scale,
      y: (e.clientY - (r?.top ?? 0)) * scale,
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5,
    };
  };

  const erase = (at: InkPoint, current: StoredStroke[]) => {
    const removed = current
      .map((stroke, index) => ({ stroke, index }))
      .filter((r) => hits(r.stroke, at));
    if (!removed.length) return current;
    const next = undo.apply(current, { kind: 'erase', removed });
    setStrokes(next);
    persist(next, height);
    return next;
  };

  const inside = (p: InkPoint, b: { x: number; y: number; w: number; h: number }) =>
    p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

  /** Moves the selected strokes (one undo step) and text boxes; the page grows if needed. */
  const moveSelection = (dx: number, dy: number) => {
    const next = undo.apply(strokes, { kind: 'move', indices: selection.strokes, dx, dy });
    const ids = new Set(selection.texts);
    const movedTexts = texts.map((t) => (ids.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t));
    const box = selectionBox(next, movedTexts, selection, TEXT_BOX_WIDTH);
    const h = box ? grownHeight(height, box.y + box.h) : height;
    setStrokes(next);
    setTexts(movedTexts);
    setHeight(h);
    persist(next, h, movedTexts);
  };

  const clip = useInkClipboard();

  const copySelection = () =>
    copyInk({
      strokes: selection.strokes.flatMap((i) => (strokes[i] ? [strokes[i]] : [])),
      texts: texts.filter((t) => selection.texts.includes(t.id)),
    });

  /** Pastes the clipboard (one undo step), offset from where it came from, and selects it. */
  const paste = () => {
    if (!clip) return;
    const add = pasted(clip);
    const next = add.strokes.length
      ? undo.apply(strokes, { kind: 'paste', strokes: add.strokes })
      : strokes;
    const nextTexts = [...texts, ...add.texts];
    const sel: Selection = {
      strokes: add.strokes.map((_, i) => strokes.length + i),
      texts: add.texts.map((t) => t.id),
    };
    const box = selectionBox(next, nextTexts, sel, TEXT_BOX_WIDTH);
    const h = box ? grownHeight(height, box.y + box.h) : height;
    setStrokes(next);
    setTexts(nextTexts);
    setHeight(h);
    setMode('lasso');
    setSelection(sel);
    persist(next, h, nextTexts);
  };

  /** Deletes the selected strokes (one undo step) and text boxes. */
  const deleteSelection = () => {
    const removed = selection.strokes.flatMap((index) => {
      const stroke = strokes[index];
      return stroke ? [{ index, stroke }] : [];
    });
    const next = removed.length ? undo.apply(strokes, { kind: 'erase', removed }) : strokes;
    const ids = new Set(selection.texts);
    const keptTexts = texts.filter((t) => !ids.has(t.id));
    setStrokes(next);
    setTexts(keptTexts);
    setSelection(EMPTY_SELECTION);
    persist(next, height, keptTexts);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      // Fingers scroll the page; only the Pencil (or a mouse) writes.
      fingerY.current = e.clientY;
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const at = toPage(e);
    if (mode === 'lasso' && selBox && inside(at, selBox)) {
      dragFrom.current = at;
      setDrag({ dx: 0, dy: 0 });
      return;
    }
    if (mode === 'lasso') {
      drawing.current = [at];
      setLoop([at]);
      setSelection(EMPTY_SELECTION);
      return;
    }
    if (mode === 'text') {
      // Keep focus in the new box (the page itself would take it and blur the box away).
      e.preventDefault();
      const id = crypto.randomUUID();
      const next = addText(texts, at.x, at.y - 12, height, id);
      setTexts(next);
      setFocusId(id);
      return;
    }
    if (mode === 'eraser') {
      erase(at, strokes);
      drawing.current = [];
      return;
    }
    drawing.current = [at];
    setLive([at]);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      if (fingerY.current !== null) {
        const scroller = svg.current?.closest('main');
        scroller?.scrollBy(0, fingerY.current - e.clientY);
        fingerY.current = e.clientY;
      }
      return;
    }
    if (dragFrom.current && selBox) {
      const at = toPage(e);
      setDrag(clampMove(selBox, at.x - dragFrom.current.x, at.y - dragFrom.current.y));
      return;
    }
    if (!drawing.current) return;
    const at = toPage(e);
    if (mode === 'lasso') {
      drawing.current.push(at);
      setLoop([...drawing.current]);
      return;
    }
    if (mode === 'eraser') {
      erase(at, strokes);
      return;
    }
    drawing.current.push(at);
    setLive([...drawing.current]);
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      fingerY.current = null;
      return;
    }
    if (dragFrom.current) {
      dragFrom.current = null;
      const d = drag;
      setDrag(null);
      if (d && (d.dx !== 0 || d.dy !== 0)) moveSelection(d.dx, d.dy);
      return;
    }
    const pts = drawing.current;
    drawing.current = null;
    setLive(null);
    if (mode === 'lasso') {
      setLoop(null);
      setSelection(selectByLasso(strokes, texts, pts ?? []));
      return;
    }
    if (!pts || mode === 'eraser' || mode === 'text' || pts.length === 0) return;
    const tool: Tool = mode;
    const stroke: StoredStroke = {
      tool,
      color: tool === 'highlighter' ? HIGHLIGHTER.color : color,
      width: tool === 'highlighter' ? HIGHLIGHTER.width : width,
      d: encodePoints(simplify(pts)),
    };
    const next = undo.apply(strokes, { kind: 'add', stroke });
    const h = grownHeight(height, Math.max(...pts.map((p) => p.y)));
    setStrokes(next);
    setHeight(h);
    persist(next, h);
  };

  const step = (kind: 'undo' | 'redo') => {
    const next = kind === 'undo' ? undo.undo(strokes) : undo.redo(strokes);
    setStrokes(next);
    persist(next, height);
  };

  const liveStroke: StoredStroke | null = live
    ? {
        tool: mode === 'highlighter' ? 'highlighter' : 'pen',
        color: mode === 'highlighter' ? HIGHLIGHTER.color : color,
        width: mode === 'highlighter' ? HIGHLIGHTER.width : width,
        d: encodePoints(live),
      }
    : null;

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Pen tools"
        className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white/95 py-2 dark:border-slate-800 dark:bg-slate-950/95"
      >
        <button
          type="button"
          aria-pressed={mode === 'pen'}
          className={btn(mode === 'pen')}
          onClick={() => pick('pen')}
        >
          Pen
        </button>
        {COLORS.map(([c, name]) => (
          <button
            key={c}
            type="button"
            aria-label={`${name} ink`}
            aria-pressed={mode === 'pen' && color === c}
            className={`size-6 rounded-full border-2 ${mode === 'pen' && color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'}`}
            style={{ background: c }}
            onClick={() => {
              pick('pen');
              setColor(c);
            }}
          />
        ))}
        {WIDTHS.map(([w, name]) => (
          <button
            key={w}
            type="button"
            aria-pressed={width === w}
            className={btn(width === w)}
            onClick={() => setWidth(w)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === 'highlighter'}
          className={btn(mode === 'highlighter')}
          onClick={() => pick('highlighter')}
        >
          Highlighter
        </button>
        <button
          type="button"
          aria-pressed={mode === 'eraser'}
          className={btn(mode === 'eraser')}
          onClick={() => pick('eraser')}
        >
          Eraser
        </button>
        <button
          type="button"
          aria-pressed={mode === 'text'}
          className={btn(mode === 'text')}
          onClick={() => pick('text')}
        >
          Text
        </button>
        <button
          type="button"
          aria-pressed={mode === 'lasso'}
          className={btn(mode === 'lasso')}
          onClick={() => pick('lasso')}
        >
          Lasso
        </button>
        {selBox && (
          <>
            <button type="button" className={btn(false)} onClick={copySelection}>
              Copy selection
            </button>
            <button type="button" className={btn(false)} onClick={deleteSelection}>
              Delete selection
            </button>
          </>
        )}
        {clip && (clip.strokes.length > 0 || clip.texts.length > 0) && (
          <button type="button" className={btn(false)} onClick={paste}>
            Paste
          </button>
        )}
        <button
          type="button"
          className={btn(false)}
          disabled={!undo.canUndo}
          onClick={() => step('undo')}
        >
          Undo
        </button>
        <button
          type="button"
          className={btn(false)}
          disabled={!undo.canRedo}
          onClick={() => step('redo')}
        >
          Redo
        </button>
      </div>
      <div className="relative">
        <svg
          ref={svg}
          role="img"
          aria-label="Handwritten page"
          viewBox={`0 0 ${PAGE_WIDTH} ${height}`}
          className="w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800"
          style={{ touchAction: 'none', aspectRatio: `${PAGE_WIDTH} / ${height}` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {[
            ...(drag && (drag.dx || drag.dy)
              ? strokes.map((st, i) =>
                  selection.strokes.includes(i) ? translateStroke(st, drag.dx, drag.dy) : st,
                )
              : strokes),
            ...(liveStroke ? [liveStroke] : []),
          ].map((s, i) => (
            <path
              key={i}
              data-stroke={i < strokes.length ? 'saved' : 'live'}
              d={strokePath(s)}
              fill={s.color}
              opacity={s.tool === 'highlighter' ? 0.35 : 1}
            />
          ))}
          {loop && loop.length > 1 && (
            <polyline
              data-lasso="loop"
              points={loop.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#6366f1"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {selBox && (
            <rect
              data-lasso="selection"
              aria-label="Selection"
              x={selBox.x + (drag?.dx ?? 0)}
              y={selBox.y + (drag?.dy ?? 0)}
              width={selBox.w}
              height={selBox.h}
              fill="#6366f1"
              fillOpacity={0.06}
              stroke="#6366f1"
              strokeWidth={2}
              strokeDasharray="8 6"
            />
          )}
        </svg>
        {texts.map((t) => (
          <div
            key={t.id}
            className="absolute flex items-start gap-1"
            style={{
              left: `${(t.x / PAGE_WIDTH) * 100}%`,
              top: `${(t.y / height) * 100}%`,
              width: `${(TEXT_BOX_WIDTH / PAGE_WIDTH) * 100}%`,
            }}
          >
            {mode === 'text' && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Move text box ${t.text || 'new'}`}
                className="cursor-move touch-none select-none px-1 text-slate-400"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  const at = toPage(e);
                  moving.current = { id: t.id, dx: at.x - t.x, dy: at.y - t.y };
                }}
                onPointerMove={(e) => {
                  const m = moving.current;
                  if (!m || m.id !== t.id) return;
                  const at = toPage(e);
                  setTexts((cur) => moveText(cur, t.id, at.x - m.dx, at.y - m.dy, height));
                }}
                onPointerUp={() => {
                  moving.current = null;
                  setTexts((cur) => {
                    persist(strokes, height, cur);
                    return cur;
                  });
                }}
              >
                ⠿
              </span>
            )}
            <input
              aria-label="Text box"
              value={t.text}
              autoFocus={focusId === t.id}
              onChange={(e) => {
                const next = editText(texts, t.id, e.target.value);
                setTexts(next);
                persist(strokes, height, next);
              }}
              onBlur={() => {
                if (!t.text.trim()) setTexts((cur) => removeText(cur, t.id));
              }}
              className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-lg text-slate-900 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:text-slate-100"
            />
            {mode === 'text' && (
              <button
                type="button"
                aria-label={`Delete text box ${t.text || 'new'}`}
                className="px-1 text-slate-400 hover:text-red-600"
                onClick={() => {
                  const next = removeText(texts, t.id);
                  setTexts(next);
                  persist(strokes, height, next);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
