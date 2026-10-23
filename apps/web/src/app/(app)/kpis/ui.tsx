import Link from 'next/link';
import { KPI_LEVEL_LABELS, KPI_PRACTICE_BADGE, KPI_PRACTICE_BANNER, type KpiHeatmap, type KpiLevel, type KpiScorecardSummary, type KpiStatus, type KpiScorer } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDate } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { heatCell, latestOf, levelRows, levelsLabel, monthShort } from './heatmap';
import { actionButton, actionText, LEVEL_BADGE, LEVEL_BAR, percentText, STATUS_BADGE, statusText } from './scorecard';
import { joinShown, shownCode } from '@/lib/hidden';

// The KPI pages' parts (owner, 21 October 2026: "Full framework per role"; the prototype's screens/KPIs.html): a level's
// badge, a step's badge, a final % with its level (or a dash with the step, until it is shown), the heatmap of people ×
// months coloured by level, the levels' distribution, and the table of scorecards the lists share. No hooks and nothing
// server-only: server and client pages use them alike.

const dash = <span className="text-muted">—</span>;

/** A level's badge: "Needs improvement", coloured as the prototype's lv-* classes. */
export function LevelBadge({ level, className = '' }: { level: KpiLevel | null | undefined; className?: string }) {
  if (!level) return dash;
  return <span className={`badge ${LEVEL_BADGE[level]} ${className}`.trim()}>{KPI_LEVEL_LABELS[level]}</span>;
}

/** Where a scorecard stands: "Self-rating", "With the manager" (or HR, the CEO), "With HR", "Sign-off", "Final". */
export function StatusBadge({ status, scorer }: { status: KpiStatus; scorer: KpiScorer }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{statusText(status, scorer)}</span>;
}

/**
 * A practice scorecard's badge, in every list it appears in (owner, 22 October 2026: "It's marked Practice
 * everywhere"): its title says it counts nowhere.
 */
export function PracticeBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`badge bg-warn-soft text-warn ${className}`.trim()} title={KPI_PRACTICE_BANNER}>
      {KPI_PRACTICE_BADGE}
    </span>
  );
}

/**
 * All KPIs' tabs for HR and the Super Admin: the month's scorecards, and the practice scorecards (owner, 22 October
 * 2026: "Practice scorecards"). Links, each page its own address.
 */
export function AllKpisTabs({ current }: { current: 'scorecards' | 'practice' }) {
  const tabs = [
    { key: 'scorecards', href: KPI_PATHS.all, label: 'Scorecards' },
    { key: 'practice', href: KPI_PATHS.practice, label: 'Practice' },
  ] as const;
  return (
    <nav aria-label="All KPIs" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? 'page' : undefined}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap no-underline ${t.key === current ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A final % and its level; a dash until it is scored, or shown to the caller (the employee: from the sign-off). */
export function PercentCell({ percent, level, pending }: { percent: number | null; level: KpiLevel | null; pending?: string | null }) {
  if (percent === null) {
    return (
      <>
        {dash}
        {pending && <span className="block text-xs text-muted">{pending}</span>}
      </>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-semibold tabular-nums">{percentText(percent)}</span>
      <LevelBadge level={level} />
    </span>
  );
}

/** A thin bar of a final % (up to the 110% cap), coloured by its level. */
export function ScoreBar({ percent, level }: { percent: number; level: KpiLevel }) {
  const width = Math.max(0, Math.min(100, (percent / 110) * 100));
  return (
    <span aria-hidden="true" className="block h-2 w-full rounded-full bg-line-soft">
      <span className={`block h-2 rounded-full ${LEVEL_BAR[level]}`} style={{ width: `${width}%` }} />
    </span>
  );
}

/** The levels of a month's scored scorecards: a bar of their shares and each level's count, with its band. */
export function LevelDistribution({ counts, caption }: { counts: Partial<Record<KpiLevel, number>>; caption?: string }) {
  const rows = levelRows(counts);
  const scored = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="space-y-4">
      {caption && <p className="text-sm text-muted">{caption}</p>}
      {scored > 0 ? (
        <div role="img" aria-label={levelsLabel(rows)} className="flex h-4 gap-0.5 overflow-hidden rounded-full">
          {rows
            .filter((r) => r.count > 0)
            .map((r) => (
              <span key={r.level} className={LEVEL_BAR[r.level]} style={{ width: `${r.share}%` }} />
            ))}
        </div>
      ) : (
        <p className="text-sm text-muted">None scored yet.</p>
      )}
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.level} className="flex items-center gap-2.5">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-sm ${LEVEL_BAR[r.level]}`} />
            <span className="flex-1">
              {r.label} <span className="text-muted">{r.range}</span>
            </span>
            <span className="font-semibold tabular-nums">{r.count}</span>
            <span className="w-12 text-right text-xs text-muted tabular-nums">{scored ? `${r.share}%` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * People × months (owner's brief, 21 October 2026: "a team overview heatmap (people × months, final % coloured by
 * level)"): each person's final % a month, coloured by its level and opening its scorecard, a month without one empty;
 * then their latest level and the change from the scored month before.
 */
export function Heatmap({ heatmap, label }: { heatmap: KpiHeatmap; label: string }) {
  if (!heatmap.rows.length) return <p className="px-4 py-6 text-sm text-muted">No scorecards in these months yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Employee</th>
            {heatmap.months.map((m) => (
              <th key={m} scope="col" className="text-center">
                {monthShort(m)}
              </th>
            ))}
            <th scope="col" className="text-right">
              Change
            </th>
            <th scope="col">Latest Level</th>
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map((r) => {
            const latest = latestOf(r.cells);
            return (
              <tr key={r.employee.id}>
                <td className="min-w-44">
                  <span className="font-semibold">{r.employee.fullNameEn}</span>
                  {(r.jobTitle || r.department) && <span className="block text-xs text-muted">{[r.jobTitle, r.department].filter(Boolean).join(' · ')}</span>}
                </td>
                {heatmap.months.map((m, i) => {
                  const c = heatCell(r.cells[i] ?? null, m, r.employee.fullNameEn);
                  const box = `block min-w-16 rounded-md px-1.5 py-2 text-center text-xs font-semibold tabular-nums no-underline ${c.className}`;
                  return (
                    <td key={m} className="px-1.5 py-1.5">
                      {c.href ? (
                        <Link href={c.href} aria-label={c.label} className={`${box} hover:ring-2 hover:ring-accent/40`}>
                          {c.text}
                        </Link>
                      ) : (
                        <span aria-label={c.label} role="img" className={box}>
                          {c.text || ' '}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="text-right text-sm whitespace-nowrap tabular-nums">{latest?.change ?? dash}</td>
                <td>
                  <LevelBadge level={latest?.level} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Scorecards in a table (Team KPIs, All KPIs): the person (C-level marked), where they work, the step with its deadline,
 * the final % and level, HR's changes, the signatures, and the way in: the caller's action (Score, Calibrate, Sign) or
 * Open.
 */
export function ScorecardsTable({ scorecards, showMonth = false }: { scorecards: KpiScorecardSummary[]; showMonth?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            {showMonth && <th scope="col">Month</th>}
            <th scope="col">Step</th>
            <th scope="col">Final %</th>
            <th scope="col" className="text-right">
              Calibrated
            </th>
            <th scope="col">Signed</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {scorecards.map((s) => {
            const todo = actionText(s);
            return (
              <tr key={s.id} className="align-top">
                <td className="min-w-48">
                  <Link href={KPI_PATHS.scorecard(s.id)} className="font-semibold">
                    {s.employee.fullNameEn}
                  </Link>
                  {s.confidential && <CLevelBadge className="ml-1.5" title="A C-level person: the CEO scores their KPI, and HR doesn't see it." />}
                  {s.practice && <PracticeBadge className="ml-1.5" />}
                  <span className="block text-xs text-muted">{joinShown([s.jobTitle, s.department]) || shownCode(s.employee.employeeCode)}</span>
                </td>
                {showMonth && <td className="whitespace-nowrap">{monthShort(s.month)}</td>}
                <td className="min-w-40">
                  <StatusBadge status={s.status} scorer={s.scorer.kind} />
                  {todo ? (
                    <span className="mt-1 block text-xs font-medium tabular-nums">{todo}</span>
                  ) : (
                    s.deadline && <span className="mt-1 block text-xs text-muted tabular-nums">Due {formatDate(s.deadline)}</span>
                  )}
                  {s.selfMissed && <span className="block text-xs text-warn">Self-rating missed</span>}
                </td>
                <td className="min-w-40">
                  <PercentCell percent={s.finalPercent} level={s.level} pending={s.status === 'final' ? null : 'Not scored yet'} />
                </td>
                <td className="text-right tabular-nums">{s.calibrated ? s.calibrated : dash}</td>
                <td className="min-w-32 text-xs">
                  <span className={`block ${s.signed.employee ? 'text-ok' : 'text-muted'}`}>{s.signed.employee ? '✓' : '○'} Employee</span>
                  <span className={`block ${s.signed.manager ? 'text-ok' : 'text-muted'}`}>{s.signed.manager ? '✓' : '○'} Manager</span>
                  {s.unsigned && <span className="block text-warn">Final unsigned</span>}
                </td>
                <td className="text-right">
                  <Link href={KPI_PATHS.scorecard(s.id)} className={s.action ? 'btn btn-primary min-h-9 px-3 whitespace-nowrap' : 'text-sm font-semibold'}>
                    {actionButton(s)}
                    <span className="sr-only"> the KPI scorecard of {s.employee.fullNameEn}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
