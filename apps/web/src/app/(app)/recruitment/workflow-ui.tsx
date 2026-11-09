import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { RefineLink, RefineNav, WorkflowLink, WorkflowNav } from './workflow';

// The hiring workflow and the filters, drawn apart (owner, 9 November 2026: "diffrenitate between the filteration and
// hiring workflow"; workflow.ts): the workflow as its steps in a row, joined by arrows, each with its count, those out of
// it apart below; the filters in their own panel, each group named (Show only, Source, Sort by), as toggles.

const eyebrow = 'text-xs font-semibold tracking-wide text-muted uppercase';

/** A step: its count over its name (or the name alone when not counted here), the one shown in ink. */
function Step({ link, n }: { link: WorkflowLink; n?: number }) {
  const zero = link.count === 0 && !link.current;
  return (
    <Link
      href={link.href}
      aria-current={link.current ? 'page' : undefined}
      className={`flex min-w-28 shrink-0 flex-col justify-center gap-0.5 rounded-xl border px-3.5 py-2 no-underline transition-colors ${
        link.current ? 'border-ink bg-ink text-on-accent hover:text-on-accent' : 'border-line bg-card text-ink hover:bg-raised hover:text-ink'
      }`}
    >
      <span className={`text-xs font-medium whitespace-nowrap ${link.current ? 'text-on-accent/80' : 'text-muted'}`}>
        {n !== undefined && <span className="tabular-nums">{n}. </span>}
        {link.label}
      </span>
      {link.count !== null && <span className={`text-xl leading-tight font-semibold tabular-nums ${zero ? 'text-muted' : ''}`}>{link.count}</span>}
    </Link>
  );
}

/** Where people stand: All, the steps in order, and those out of the workflow. */
export function HiringWorkflow({ nav }: { nav: WorkflowNav }) {
  return (
    <nav aria-label="Hiring workflow" className="space-y-2.5">
      <p className={eyebrow}>Hiring workflow</p>
      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        <Step link={nav.all} />
        <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-line" />
        <ol className="flex items-stretch gap-1.5">
          {nav.steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" strokeWidth={1.8} />}
              <Step link={s} n={i + 1} />
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Out of the workflow:</span>
        {nav.out.map((o) => (
          <Link
            key={o.key}
            href={o.href}
            aria-current={o.current ? 'page' : undefined}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed px-3 font-medium no-underline ${
              o.current ? 'border-ink bg-ink text-on-accent hover:text-on-accent' : 'border-line text-ink hover:bg-raised hover:text-ink'
            }`}
          >
            {o.label}
            {o.count !== null && <span className={`tabular-nums ${o.current ? '' : 'text-muted'}`}>{o.count}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** A filter as a toggle: a box ticked when on. */
function Toggle({ link }: { link: RefineLink }) {
  return (
    <Link
      href={link.href}
      aria-pressed={link.on}
      className={`inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 text-sm font-medium no-underline ${
        link.on ? 'border-ink bg-card text-ink hover:text-ink' : 'border-line bg-card text-ink hover:bg-canvas hover:text-ink'
      }`}
    >
      <span aria-hidden="true" className={`grid size-4 place-items-center rounded border ${link.on ? 'border-ink bg-ink text-on-accent' : 'border-line'}`}>
        {link.on && <Check className="size-3" strokeWidth={3} />}
      </span>
      {link.label}
      {link.count !== undefined && <span className="text-muted tabular-nums">{link.count}</span>}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${eyebrow} w-full sm:w-auto`}>{label}</span>
      {children}
    </div>
  );
}

/** Who is shown within the step, and in what order: its own panel. */
export function ApplicantFilters({ nav }: { nav: RefineNav }) {
  return (
    <div role="group" aria-label="Filter and sort" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-raised px-4 py-3">
      <Group label="Show only">
        {nav.only.map((l) => (
          <Toggle key={l.key} link={l} />
        ))}
      </Group>
      {nav.sources.length > 0 && (
        <Group label="Source">
          {nav.sources.map((l) => (
            <Toggle key={l.key} link={l} />
          ))}
        </Group>
      )}
      <Group label="Sort by">
        <span className="inline-flex flex-wrap rounded-lg border border-line bg-card p-0.5">
          {nav.sorts.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              aria-pressed={l.on}
              className={`inline-flex min-h-7 items-center rounded-md px-2.5 text-sm font-medium no-underline ${l.on ? 'bg-ink text-on-accent hover:text-on-accent' : 'text-ink hover:bg-canvas hover:text-ink'}`}
            >
              {l.label}
            </Link>
          ))}
        </span>
      </Group>
      {nav.clear && (
        <Link href={nav.clear} className="ml-auto text-sm font-semibold">
          Clear filters
        </Link>
      )}
    </div>
  );
}

/**
 * A card that opens and closes (owner, 9 November 2026, a vacancy's Apply Links and On the Careers Page: "make them
 * collapsable, to save some space and prevent long scrolling"): closed at first, its title and a line of what is inside.
 */
export function CollapsibleCard({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {hint && <span className="block text-sm text-muted group-open:hidden">{hint}</span>}
        </span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" strokeWidth={1.6} />
      </summary>
      <div className="space-y-4 border-t border-line-soft px-6 pt-4 pb-6">{children}</div>
    </details>
  );
}
