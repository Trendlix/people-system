import Link from 'next/link';

// The phone pages' small parts (owner, 20 October 2026: the employee app): a page's title with its way back, a card with
// its heading, a row to tap (the whole row a target), a quiet line, the line saying what was just done, and chips.
// No hooks and nothing server-only: server and client pages use them alike.

/** A page's title (Title Case), its way back above it when it has one, and a line under it. */
export function PageTitle({ title, back, children }: { title: string; back?: { href: string; label: string } | null; children?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {back && (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <p className="text-sm text-muted">{children}</p>}
    </div>
  );
}

/** A card with its heading (Title Case) and, beside it, a way on. */
export function PhoneCard({ title, action, children, flush = false }: { title?: string; action?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className={`card ${flush ? '' : 'p-4'}`}>
      {(title || action) && (
        <div className={`flex items-baseline justify-between gap-3 ${flush ? 'px-4 pt-4' : ''}`}>
          {title && <h2 className="font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className={title || action ? (flush ? 'mt-2' : 'mt-3') : undefined}>{children}</div>
    </section>
  );
}

/** A row to tap: what it is, a line under it, and on the right what it says of itself (a badge), then the arrow. */
export function RowLink({ href, title, line, aside, srExtra }: { href: string; title: React.ReactNode; line?: React.ReactNode; aside?: React.ReactNode; srExtra?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-canvas active:bg-canvas">
        <span className="min-w-0 flex-1">
          <span className="block font-medium break-words">
            {title}
            {srExtra && <span className="sr-only">, {srExtra}</span>}
          </span>
          {line && <span className="mt-0.5 block text-xs text-muted">{line}</span>}
        </span>
        {aside && <span className="shrink-0 text-right">{aside}</span>}
        <span aria-hidden="true" className="shrink-0 text-lg text-muted">
          ›
        </span>
      </Link>
    </li>
  );
}

/** Rows to tap, in a card. */
export function RowList({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line-soft">
      {children}
    </ul>
  );
}

export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** Grey lines where a card's rows will be, while they load (Phase 5, 20 October 2026: loading states). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-line-soft">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1 space-y-2">
            <span className={`block h-3.5 rounded-full bg-line motion-safe:animate-pulse ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
            <span className="block h-3 w-1/3 rounded-full bg-line-soft motion-safe:animate-pulse" />
          </span>
          <span className="h-5 w-14 shrink-0 rounded-full bg-line-soft motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * While a page (or its part) loads: a card of grey lines where its rows will be, said as "Loading…" to a screen reader
 * (Phase 5, 20 October 2026: loading states; every phone page's Suspense shows it under the page's own title).
 */
export function PhoneLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" className="card overflow-hidden">
      <span className="sr-only">Loading…</span>
      <SkeletonRows rows={rows} />
    </div>
  );
}

/** What was just done, said at the top: in green, or in amber when it moved on meanwhile. */
export function DoneLine({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' }) {
  return (
    <p role="status" className={`rounded-lg px-4 py-3 text-sm ${tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
      {text}
    </p>
  );
}

const chip = 'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap no-underline';

/** A filter chip: a link, the one chosen dark, with how many it lists. */
export function Chip({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`${chip} ${active ? 'border-ink bg-ink text-on-accent hover:text-on-accent' : 'border-line bg-card text-ink hover:bg-canvas hover:text-ink'}`}>
      {label}
      {count !== undefined && <span className={`tabular-nums ${active ? 'opacity-75' : 'text-muted'}`}>{count}</span>}
    </Link>
  );
}
