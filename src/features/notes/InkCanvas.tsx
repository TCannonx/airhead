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

type Mode = Tool | 'eraser' | 'text';

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

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      // Fingers scroll the page; only the Pencil (or a mouse) writes.
      fingerY.current = e.clientY;
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const at = toPage(e);
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
    if (!drawing.current) return;
    const at = toPage(e);
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
    const pts = drawing.current;
    drawing.current = null;
    setLive(null);
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
          onClick={() => setMode('pen')}
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
              setMode('pen');
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
          onClick={() => setMode('highlighter')}
        >
          Highlighter
        </button>
        <button
          type="button"
          aria-pressed={mode === 'eraser'}
          className={btn(mode === 'eraser')}
          onClick={() => setMode('eraser')}
        >
          Eraser
        </button>
        <button
          type="button"
          aria-pressed={mode === 'text'}
          className={btn(mode === 'text')}
          onClick={() => setMode('text')}
        >
          Text
        </button>
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
          {[...strokes, ...(liveStroke ? [liveStroke] : [])].map((s, i) => (
            <path
              key={i}
              data-stroke={i < strokes.length ? 'saved' : 'live'}
              d={strokePath(s)}
              fill={s.color}
              opacity={s.tool === 'highlighter' ? 0.35 : 1}
            />
          ))}
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
