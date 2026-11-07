import { PAGE_WIDTH, strokePath, type InkDoc } from '../../lib/ink/strokes';
import { TEXT_BOX_WIDTH } from '../../lib/ink/texts';

/**
 * A handwritten page to read, not write on (Task 6.9): phone and desktop show
 * summarised pages view-only, so a stray touch or click can't mark them.
 */
export default function InkView({ doc }: { doc: InkDoc }) {
  return (
    <div className="space-y-4">
      {doc.pages.map((page, n) => (
        <div key={n} className="relative">
          <svg
            role="img"
            aria-label={`Handwritten page ${n + 1} (view only)`}
            viewBox={`0 0 ${PAGE_WIDTH} ${page.height}`}
            className="w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800"
            style={{ aspectRatio: `${PAGE_WIDTH} / ${page.height}` }}
          >
            {page.strokes.map((s, i) => (
              <path
                key={i}
                d={strokePath(s)}
                fill={s.color}
                opacity={s.tool === 'highlighter' ? 0.35 : 1}
              />
            ))}
          </svg>
          {page.texts
            .filter((t) => t.text.trim())
            .map((t) => (
              <p
                key={t.id}
                className="absolute px-2 text-lg text-slate-900"
                style={{
                  left: `${(t.x / PAGE_WIDTH) * 100}%`,
                  top: `${(t.y / page.height) * 100}%`,
                  width: `${(TEXT_BOX_WIDTH / PAGE_WIDTH) * 100}%`,
                }}
              >
                {t.text}
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}
