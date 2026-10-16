import type { CostChart } from './reports';

// The company cost month by month, as bars drawn on the server from costChart (reports.ts): inline SVG, no chart
// library, to scale from 0, sized to its box. One series, so no legend: the heading says what it is. The colours are
// the theme's (fill-accent, text-muted, stroke-line), so it reads in light and dark. One picture to screen readers
// (role="img" with the chart in words); every value is in the table below it. Each bar names its month and cost on hover.

export function CostTrendChart({ chart: c }: { chart: CostChart }) {
  return (
    <figure className="card p-4">
      {/* scrolls sideways on a phone rather than shrinking its labels out of reading */}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={c.description} className="h-auto w-full min-w-[32rem] text-muted">
          {c.yTicks.map((t) => (
            <g key={t.label}>
              <line x1={c.plot.left} x2={c.plot.right} y1={t.y} y2={t.y} className="stroke-line-soft" strokeWidth={1} />
              <text x={c.plot.left - 8} y={t.y} dy="0.32em" textAnchor="end" fill="currentColor" className="text-[11px] tabular-nums">
                {t.label}
              </text>
            </g>
          ))}
          {c.bars.map((b) => (
            <g key={b.month}>
              <title>{b.title}</title>
              <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={2} className="fill-accent" />
            </g>
          ))}
          <line x1={c.plot.left} x2={c.plot.right} y1={c.plot.bottom} y2={c.plot.bottom} className="stroke-line" strokeWidth={1} />
          {c.xTicks.map((t) => (
            <text key={`${t.x}:${t.label}`} x={t.x} y={c.plot.bottom + 17} textAnchor="middle" fill="currentColor" className="text-[11px]">
              {t.label}
            </text>
          ))}
        </svg>
      </div>
      <figcaption className="mt-2 text-xs text-muted">Company cost a month, in EGP: earned, allowances and the company&apos;s social insurance share. A gap is a month with no approved run.</figcaption>
    </figure>
  );
}
