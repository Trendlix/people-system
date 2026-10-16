import type { StepChart } from './salary-history';

// The gross over an employment as a step chart, drawn on the server from stepChart (salary-history.ts): inline SVG, no
// chart library, sized to its box. One series, so no legend: the section's heading says what it is. The colours are the
// theme's (stroke-accent, text-muted…), so the chart follows the page in light and dark. It is one picture to screen
// readers (role="img" with the chart in words); every value is in the timeline below it, which is its text version.
// Each point names its event, date and gross on hover (an SVG <title>), over a hit area larger than the dot.

export function GrossStepChart({ chart: c }: { chart: StepChart }) {
  return (
    <figure className="card p-4">
      {/* scrolls sideways on a phone rather than shrinking its labels out of reading */}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={c.description} className="h-auto w-full min-w-[32rem] text-muted">
          {/* the axis: round amounts, hairline gridlines */}
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
            <g key={`${t.x}:${t.label}`}>
              <line x1={t.x} x2={t.x} y1={c.plot.bottom} y2={c.plot.bottom + 4} className="stroke-line" strokeWidth={1} />
              <text x={t.x} y={c.plot.bottom + 17} textAnchor="middle" fill="currentColor" className="text-[11px]">
                {t.label}
              </text>
            </g>
          ))}

          {/* today, while the employment is current and something comes after it */}
          {c.today !== null && (
            <g>
              <line x1={c.today} x2={c.today} y1={c.plot.top} y2={c.plot.bottom} className="stroke-line" strokeWidth={1} />
              <text x={c.today} y={c.plot.top - 4} textAnchor="middle" fill="currentColor" className="text-[11px]">
                Today
              </text>
            </g>
          )}

          {/* the gross paid, and a signed raise still to come (dashed: not in force yet) */}
          {c.solid && <path d={c.solid} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {c.future && (
            <path
              d={c.future}
              fill="none"
              className="stroke-accent"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {c.points.map((p) => (
            <g key={p.key}>
              <title>{p.state === 'upcoming' ? `${p.label} (to come)` : p.state === 'current' ? `${p.label} (now)` : p.label}</title>
              {/* the hit area: bigger than the dot */}
              <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={p.state === 'current' ? 6 : 4.5}
                strokeWidth={2}
                className={p.state === 'upcoming' ? 'fill-card stroke-accent' : 'fill-accent stroke-card'}
              />
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span>Gross a month, in EGP, from each signed version&apos;s effective date.</span>
        {c.points.some((p) => p.state === 'current') && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-3 rounded-full bg-accent" />
            The larger dot: the gross in force today
          </span>
        )}
        {c.future && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed border-accent" />
            Signed, not in force yet
          </span>
        )}
      </figcaption>
    </figure>
  );
}
