import { ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

// The owner's design's pieces (Figma "PeopleTrendlix", the desktop version, 30 October 2026), for the pages built to it
// (the Dashboard, My Requests, My Attendance, My KPIs) and any page that wants them: a page's head (the small capitals,
// the large title, a line under it, its buttons on the right), a panel's head (the small capitals over a title), a stat
// tile, a badge, the underlined link with its arrow, the icon's tile and the ring. Colours from globals.css, so they
// follow the light and the dark look.

/** A page's head: "PEOPLE SYSTEM · REQUESTS", the title, a line under it; the page's buttons on the right. */
export function PageHead({ eyebrow, title, intro, actions }: { eyebrow?: string; title: React.ReactNode; intro?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title mt-2">{title}</h1>
        {intro && <p className="mt-2.5 max-w-3xl text-sm text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A panel's head: the small capitals over its title ("TODAY" over "Tuesday, 27 October"); something on the right. */
export function PanelHead({ eyebrow, title, aside, level = 2 }: { eyebrow?: string; title: React.ReactNode; aside?: React.ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Heading className={`${eyebrow ? 'mt-1.5' : ''} text-xl font-medium tracking-[-0.035em]`}>{title}</Heading>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/** A panel: the design's card with room inside, and its head when it has one. */
export function Panel({
  eyebrow,
  title,
  aside,
  className = '',
  children,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={`card p-[22px] ${className}`}>
      {title !== undefined && <PanelHead eyebrow={eyebrow} title={title} aside={aside} />}
      {children !== undefined && <div className={title !== undefined ? 'mt-5' : ''}>{children}</div>}
    </section>
  );
}

/** The square an icon sits in (40px, a thin line, 12px corners). */
export function IconTile({ icon: Icon, className = '' }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-ink ${className}`}>
      <Icon className="size-[18px]" strokeWidth={1.6} />
    </span>
  );
}

/** A stat: its icon, what it counts, the figure (with its unit small after it) and a note in the corner. */
export function StatTile({ icon, label, value, unit, note, href }: { icon: LucideIcon; label: string; value: React.ReactNode; unit?: string; note?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <IconTile icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 text-[1.6rem] leading-tight font-normal tracking-[-0.04em] tabular-nums">
          {value}
          {unit && <span className="ml-1 text-xs tracking-normal text-muted">{unit}</span>}
        </p>
      </div>
      {note && <p className="self-end text-right text-[11px] text-muted">{note}</p>}
    </>
  );
  const box = 'card flex min-h-[104px] items-center gap-3 p-[17px] no-underline';
  return href ? (
    <Link href={href} className={`${box} text-ink transition-colors hover:bg-raised`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** A badge: quiet (grey, a thin line) or strong (black on light, off-white on dark). */
export function Pill({ strong = false, className = '', children }: { strong?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] leading-none whitespace-nowrap ${
        strong ? 'bg-accent text-on-accent' : 'border border-line bg-raised text-muted'
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** The design's quiet way on: words underlined, an arrow after ("Check out →", "View calendar"). */
export function ArrowLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 border-b border-ink pb-0.5 text-sm text-ink no-underline hover:opacity-80 ${className}`}>
      {children}
      <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
    </Link>
  );
}

/**
 * The design's ring (the work time, a share remaining): `share` from 0 to 1 filled from the top, clockwise, in ink over
 * the track; what it says in its middle.
 */
export function Ring({ share, size = 170, stroke = 12, label, children }: { share: number; size?: number; stroke?: number; label: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, share)) * length;
  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line-soft" />
        {filled > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${length}`}
            className="stroke-ink"
          />
        )}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
