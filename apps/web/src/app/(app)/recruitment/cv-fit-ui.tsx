import Link from 'next/link';
import { betterFitText, betterFitTitle, type BetterFitBadge, type CvFit, type OpenPositionFit } from '@trendlix/shared';
import { fitRows, fitSummary, fitTitle, matchCell, NO_OPEN_POSITIONS, type FitRecord } from './cv-fit';
import { addToOpenPosition } from './fit-actions';
import { ActionButton } from './forms';
import { applicantHref, vacancyHref } from './recruitment';

// The CV fit's pieces (owner, 25 October 2026: "aren't you supposed to match the candidate to the job based on the CV and
// ATS?"; "Full CV fit score"; "and if it recomended to another position based on the CV"): the CV match % with its
// breakdown (on hover on a computer, on tap on a phone: a native disclosure), the Match cell's "72% · CV" for those never
// asked the screening questions, the "Better fit" badge, the CV Fit section and Other Open Positions with "Add to this
// vacancy". A developer's past titles come as "••••" and are left out of the words (packages/shared cv-fit.ts).

/** A CV match %: its breakdown on hover, and under it on tap; "—" without one. */
export function FitPercent({ percent, fit, className = '' }: { percent: number | null; fit?: CvFit | null; className?: string }) {
  if (percent === null) return <span className={`tabular-nums ${className}`}>—</span>;
  const line = fitTitle(fit);
  if (!line) return <span className={`tabular-nums ${className}`}>{percent}%</span>;
  return (
    <details className={`group inline-block max-w-64 text-left align-top ${className}`}>
      <summary title={line} className="cursor-pointer list-none tabular-nums underline decoration-dotted underline-offset-4 [&::-webkit-details-marker]:hidden">
        {percent}%<span className="sr-only">: show the breakdown</span>
      </summary>
      <span className="mt-1 block text-xs font-normal whitespace-normal text-muted">{line}</span>
    </details>
  );
}

/** The Match cell's text: the screening match, else "72% · CV" muted (never asked the questions), else "—". */
export function MatchValue({ a, className = 'text-sm' }: { a: { matchPercent: number | null; cvMatchPercent: number | null; source?: string }; className?: string }) {
  const cell = matchCell(a);
  return cell.fromCv || cell.title ? (
    <span className={`text-muted ${className}`} title={cell.title ?? undefined}>
      {cell.text}
    </span>
  ) : (
    <>{cell.text}</>
  );
}

/** "Better fit: Media Buyer 82%": to that vacancy, the other open positions on hover. */
export function BetterFitLink({ badge }: { badge: BetterFitBadge }) {
  return (
    <Link href={vacancyHref(badge.vacancy.id)} title={betterFitTitle(badge)} className="badge bg-accent-soft text-accent no-underline hover:text-accent">
      {betterFitText(badge)}
    </Link>
  );
}

/** The CV Fit section: the percent, then each part with its score, its share of the fit and what it found. */
export function CvFitSection({ fit, id, level = 'h3' }: { fit: CvFit; id: string; level?: 'h2' | 'h3' }) {
  const Heading = level;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading id={id} className={level === 'h2' ? 'text-lg font-semibold' : 'text-sm font-semibold'}>
          CV Fit
        </Heading>
        {fit.percent !== null && <span className="text-sm font-semibold tabular-nums">{fit.percent}%</span>}
      </div>
      <p className="text-xs text-muted">{fitSummary(fit)}</p>
      <FitParts fit={fit} />
    </section>
  );
}

/** A fit's parts: each with its score, its share of the fit and what it found. */
function FitParts({ fit }: { fit: CvFit }) {
  if (!fit.parts.length) return null;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
      {fitRows(fit).map((r) => (
        <li key={r.key} className="space-y-0.5 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-semibold">{r.label}</span>
            <span className="tabular-nums">
              {r.score}
              <span className="text-xs text-muted"> · {r.weight}</span>
            </span>
          </div>
          <p className="text-xs break-words text-muted" dir="auto">
            {r.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The candidate's page's CV Fit (owner, 25 October 2026: "Full CV fit score"): each application's fit for its vacancy,
 * with its parts; nothing when none of their CVs is read yet.
 */
export function CandidateFits({ rows }: { rows: readonly { id: string; vacancy: { title: string }; cvFit?: CvFit | null }[] }) {
  const fitted = rows.filter((r) => r.cvFit && r.cvFit.parts.length > 0);
  if (!fitted.length) return null;
  return (
    <section aria-labelledby="candidate-cv-fit" className="card space-y-4 p-6">
      <div className="space-y-1">
        <h2 id="candidate-cv-fit" className="text-lg font-semibold">
          CV Fit
        </h2>
        <p className="text-xs text-muted">Each application’s CV against its vacancy: the parts that couldn’t be scored are left out, the others re-weighted to 100.</p>
      </div>
      {fitted.map((r) => (
        <div key={r.id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={applicantHref(r.id)} className="font-semibold">
              {r.vacancy.title}
            </Link>
            <span className="text-sm font-semibold tabular-nums">{r.cvFit!.percent === null ? '—' : `${r.cvFit!.percent}%`}</span>
          </div>
          <FitParts fit={r.cvFit!} />
        </div>
      ))}
    </section>
  );
}

/**
 * Other Open Positions: the top 3 open vacancies the CV fits at 50% or more, each with its breakdown on hover, and Add
 * to this vacancy for those who decide the suggested CVs (HR, the CEO, a Super Admin; never a developer).
 */
export function OpenPositions({
  positions,
  record,
  id,
  level = 'h3',
  card = false,
}: {
  positions: OpenPositionFit[];
  /** The CV they are added from; on the candidate's page, the one of theirs that fits each vacancy (none: no Add). */
  record: FitRecord | ((vacancyId: string) => FitRecord | null);
  id: string;
  level?: 'h2' | 'h3';
  card?: boolean;
}) {
  const Heading = level;
  return (
    <section aria-labelledby={id} className={card ? 'card space-y-3 p-6' : 'space-y-2'}>
      <div className="space-y-1">
        <Heading id={id} className={level === 'h2' ? 'text-lg font-semibold' : 'text-sm font-semibold'}>
          Other Open Positions
        </Heading>
        <p className="text-xs text-muted">Open vacancies their CV fits, by the same CV fit Suggested From Earlier CVs uses there.</p>
      </div>
      {positions.length === 0 ? (
        <p className="text-sm text-muted">{NO_OPEN_POSITIONS}</p>
      ) : (
        <ul className="space-y-2">
          {positions.map((p) => {
            const from = typeof record === 'function' ? record(p.vacancy.id) : record;
            return (
            <li key={p.vacancy.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0 space-y-0.5">
                <Link href={vacancyHref(p.vacancy.id)} className="font-semibold">
                  {p.vacancy.title}
                </Link>
                <div className="text-xs text-muted">
                  {p.vacancy.number} · CV fit <FitPercent percent={p.percent} fit={p.fit} className="text-ink" />
                </div>
              </div>
              {p.can.add && from && <ActionButton action={addToOpenPosition.bind(null, p.vacancy.id, from)} label="Add to this vacancy" pendingLabel="Adding…" />}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
