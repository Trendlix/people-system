'use client';

import { useState } from 'react';
import type { ChartTip, ColumnChart, TrendChart } from './history';

// The attendance history's charts (owner, 23 October 2026: "on-time %, average check-in time, late days by weekday and
// trends"), drawn to scale on the server (history.ts) and shown here as inline SVG in the salary history's style
// (salary-history/step-chart.tsx): no chart library, the theme's colours (stroke-accent, fill-accent, text-muted …), so
// the charts follow the page's theme; one series each, so no legend, the heading says what it is. Hover or keyboard
// focus on a mark (its hit area larger than the mark: a dot's 24px circle, a column's whole band) shows its value in a
// tooltip; each mark is announced on focus, and every value is in the table under the chart too, its text version.

function Tip({ tip, width, height }: { tip: ChartTip | null; width: number; height: number }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-ink shadow-sm"
      style={{ left: `${(tip.x / width) * 100}%`, top: `calc(${(tip.y / height) * 100}% - 10px)` }}
    >
      {tip.text}
    </div>
  );
}

/** The axes: round ticks with hairline gridlines, the baseline, and the x labels under it. */
function Axes({ c }: { c: TrendChart | ColumnChart }) {
  return (
    <>
      {c.yTicks.map((t) => (
        <g key={t.label}>
          <line x1={c.plot.left} x2={c.plot.right} y1={t.y} y2={t.y} className="stroke-line-soft" strokeWidth={1} />
          <text x={c.plot.left - 8} y={t.y} dy="0.32em" textAnchor="end" fill="currentColor" className="text-[11px] tabular-nums">
            {t.label}
          </text>
        </g>
      ))}
      <line x1={c.plot.left} x2={c.plot.right} y1={c.plot.bottom} y2={c.plot.bottom} className="stroke-line" strokeWidth={1} />
      {c.xTicks.map((t) => (
        <text key={`${t.x}:${t.label}`} x={t.x} y={c.plot.bottom + 17} textAnchor="middle" fill="currentColor" className="text-[11px]">
          {t.label}
        </text>
      ))}
    </>
  );
}

/** A chart's frame: the card, sideways scroll on a phone rather than labels shrunk out of reading, the tooltip. */
function Frame({ c, tip, caption, children }: { c: TrendChart | ColumnChart; tip: ChartTip | null; caption: string; children: React.ReactNode }) {
  return (
    <figure className="card p-4">
      <div className="overflow-x-auto">
        <div className="relative min-w-[32rem]">
          <svg viewBox={`0 0 ${c.width} ${c.height}`} role="group" aria-label={c.description} className="h-auto w-full text-muted">
            <Axes c={c} />
            {children}
          </svg>
          <Tip tip={tip} width={c.width} height={c.height} />
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

/** The on-time trend: a 2px line, a dot on each month (or quarter) measured, the latest value at the line's end. */
export function TrendLineChart({ chart: c, caption }: { chart: TrendChart; caption: string }) {
  const [tip, setTip] = useState<ChartTip | null>(null);
  return (
    <Frame c={c} tip={tip} caption={caption}>
      {c.paths.map((d) => (
        <path key={d} d={d} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {c.points.map((p) => {
        const on = tip?.key === p.key;
        return (
          <g
            key={p.key}
            tabIndex={0}
            role="img"
            aria-label={p.text}
            onPointerEnter={() => setTip(p)}
            onPointerLeave={() => setTip(null)}
            onFocus={() => setTip(p)}
            onBlur={() => setTip(null)}
            className="cursor-default outline-none"
          >
            {/* the hit area: bigger than the dot */}
            <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
            {on && <circle cx={p.x} cy={p.y} r={9} fill="none" className="stroke-ink" strokeWidth={1.5} />}
            <circle cx={p.x} cy={p.y} r={p.last ? 6 : 4.5} strokeWidth={2} className="fill-accent stroke-card" />
          </g>
        );
      })}
      {c.endLabel && (
        <text x={c.endLabel.x} y={c.endLabel.y - 12} textAnchor="middle" className="fill-ink text-[11px] font-semibold">
          {c.endLabel.text}
        </text>
      )}
    </Frame>
  );
}

/** Columns from one baseline, 4px rounded at the data end, a 2px gap between them; the hovered one darker. */
export function ColumnBarChart({ chart: c, caption }: { chart: ColumnChart; caption: string }) {
  const [tip, setTip] = useState<ChartTip | null>(null);
  return (
    <Frame c={c} tip={tip} caption={caption}>
      {c.bars.map((b) => {
        const on = tip?.key === b.key;
        return (
          <g
            key={b.key}
            tabIndex={0}
            role="img"
            aria-label={b.text}
            onPointerEnter={() => setTip(b)}
            onPointerLeave={() => setTip(null)}
            onFocus={() => setTip(b)}
            onBlur={() => setTip(null)}
            className="cursor-default outline-none"
          >
            {/* the hit area: the column's whole band, the plot's height */}
            <rect x={b.hit.x} y={c.plot.top} width={b.hit.width} height={c.plot.bottom - c.plot.top} fill="transparent" />
            {on && <rect x={b.hit.x} y={c.plot.top} width={b.hit.width} height={c.plot.bottom - c.plot.top} className="fill-canvas" />}
            {b.d && <path d={b.d} className={on ? 'fill-accent-hover' : 'fill-accent'} />}
            {b.label !== null && (
              <text x={b.x} y={b.labelY} textAnchor="middle" className="fill-ink text-[11px] font-semibold tabular-nums">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </Frame>
  );
}
