import { useState } from 'react';
import { euro } from '../../lib/ai/usage';
import { Button } from '../../ui/Button';

/**
 * Single-series daily bar chart (one hue, no legend: the title names it).
 * Thin bars with 4px rounded tops anchored to the baseline, a 2px gap,
 * recessive axis, a hover/focus tooltip per bar, and a table view.
 */
export default function DailyBars({
  days,
  title,
}: {
  days: { date: string; cost: number }[];
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 640;
  const H = 140;
  const pad = { top: 8, bottom: 20 };
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  const slot = W / Math.max(days.length, 1);
  const barW = Math.max(2, Math.min(18, slot - 2));
  const plotH = H - pad.top - pad.bottom;
  const active = hover !== null ? days[hover] : undefined;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-footnote font-medium text-fg-muted">{title}</h3>
        <Button variant="plain" size="sm" onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Show as chart' : 'Show as table'}
        </Button>
      </div>
      {asTable ? (
        <table aria-label={title} className="w-full text-footnote">
          <thead>
            <tr className="text-left text-caption text-fg-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Spend</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-border/60">
                <td className="py-1">{d.date}</td>
                <td className="py-1 text-right tabular-nums">{euro(d.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            role="img"
            aria-label={`${title}: ${days.length} days, highest ${euro(max === 0.0001 ? 0 : max)}`}
            viewBox={`0 0 ${W} ${H}`}
            className="h-36 w-full text-accent"
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            <line
              x1={0}
              x2={W}
              y1={H - pad.bottom}
              y2={H - pad.bottom}
              className="stroke-border"
              strokeWidth={1}
            />
            {days.map((d, i) => {
              const h = d.cost > 0 ? Math.max(2, (d.cost / max) * plotH) : 0;
              const x = i * slot + (slot - barW) / 2;
              const y = H - pad.bottom - h;
              return (
                <g key={d.date}>
                  {/* Bigger invisible hit target than the mark */}
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
                      data-bar
                      d={`M${x},${y + h} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + barW - 4} Q${x + barW},${y} ${x + barW},${y + 4} V${y + h} Z`}
                      fill="currentColor"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                      pointerEvents="none"
                    />
                  )}
                  <rect data-day={d.date} x={x} y={y} width={barW} height={h} fill="none" />
                </g>
              );
            })}
            <text x={0} y={H - 4} className="fill-fg-subtle text-[10px]">
              {days[0]?.date.slice(8)}
            </text>
            <text x={W} y={H - 4} textAnchor="end" className="fill-fg-subtle text-[10px]">
              {days.at(-1)?.date.slice(8)}
            </text>
          </svg>
          {active && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 rounded-md bg-fg px-2 py-1 text-caption text-canvas shadow"
              style={{ left: `${((hover ?? 0) / Math.max(days.length, 1)) * 100}%` }}
            >
              {active.date}: {euro(active.cost)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
