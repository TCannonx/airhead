import { useState } from 'react';

/**
 * A single-series bar chart (Task 8.6), the same marks as DailyBars: one hue,
 * no legend (the title names it), thin bars with 4px rounded tops on the
 * baseline, a 2px gap, recessive axis labels at the ends, a hover/focus
 * tooltip, and a table view.
 */
export default function Bars({
  title,
  bars,
  valueLabel,
  labelHeading,
}: {
  title: string;
  bars: { label: string; value: number }[];
  valueLabel: string;
  labelHeading: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 640;
  const H = 120;
  const pad = { top: 8, bottom: 20 };
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = W / Math.max(bars.length, 1);
  const barW = Math.max(2, Math.min(40, slot - 2));
  const plotH = H - pad.top - pad.bottom;
  const active = hover !== null ? bars[hover] : undefined;
  const peak = bars.reduce((best, b) => (b.value > (best?.value ?? -1) ? b : best), bars[0]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</h3>
        <button
          type="button"
          className="text-xs text-slate-500 underline"
          onClick={() => setAsTable((t) => !t)}
        >
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <table aria-label={title} className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">{labelHeading}</th>
              <th className="py-1 text-right font-medium">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.label} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1">{b.label}</td>
                <td className="py-1 text-right tabular-nums">{b.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            role="img"
            aria-label={`${title}: highest ${peak?.label ?? ''} (${peak?.value ?? 0})`}
            viewBox={`0 0 ${W} ${H}`}
            className="h-32 w-full text-indigo-600 dark:text-indigo-400"
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            <line
              x1={0}
              x2={W}
              y1={H - pad.bottom}
              y2={H - pad.bottom}
              className="stroke-slate-200 dark:stroke-slate-700"
              strokeWidth={1}
            />
            {bars.map((b, i) => {
              const h = b.value > 0 ? Math.max(2, (b.value / max) * plotH) : 0;
              const x = i * slot + (slot - barW) / 2;
              const y = H - pad.bottom - h;
              return (
                <g key={b.label}>
                  <rect
                    x={i * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                  {h > 0 && (
                    <path
                      d={`M${x},${y + h} V${y + Math.min(4, h)} Q${x},${y} ${x + 4},${y} H${x + barW - 4} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} V${y + h} Z`}
                      fill="currentColor"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
            <text x={0} y={H - 4} className="fill-slate-400 text-[10px]">
              {bars[0]?.label}
            </text>
            <text x={W} y={H - 4} textAnchor="end" className="fill-slate-400 text-[10px]">
              {bars.at(-1)?.label}
            </text>
          </svg>
          {active && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow dark:bg-slate-100 dark:text-slate-900"
              style={{ left: `${((hover ?? 0) / Math.max(bars.length, 1)) * 100}%` }}
            >
              {active.label}: {active.value}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
