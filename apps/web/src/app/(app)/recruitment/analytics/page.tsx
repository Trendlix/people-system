import { Select } from '@/components/select';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { APPLICATION_SOURCE_LABELS, APPLICATION_STAGE_LABELS, GENERAL_CV_SOURCE_LABELS, type RecruitmentAnalytics } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { loadPickers } from '../../employees/data';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { loadAnalytics, recruitmentNotLoaded } from '../data';
import { analyticsExcelHref, daysFigure, percentFigure, readAnalyticsQuery, type AnalyticsQuery } from '../hiring';
import { readsRecruitment, WHO_SEES } from '../recruitment';

// Recruitment Analytics (Phase 2, owner, 22 October 2026; the original plan's spec §12 Analytics): for a year (and a
// department, its teams with it): open positions and candidates now, the year's applicants and hires, time to hire and
// to fill, offer acceptance, probation pass rate, the funnel, hires by month, the sources and the departments, with its
// Excel. HR, the CEO and a Super Admin; a C-level vacancy is left out for HR.

export const metadata: Metadata = { title: 'Recruitment Analytics · People System' };

function Figure({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Figures({ r }: { r: RecruitmentAnalytics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Figure label="Open positions" value={r.openPositions} note={`${r.openVacancies} open ${r.openVacancies === 1 ? 'vacancy' : 'vacancies'}`} />
      <Figure label="Active candidates" value={r.activeCandidates} note="Applied to Offer, on open vacancies" />
      <Figure label="Applicants" value={r.applicants} note={`Applied in ${r.year}`} />
      <Figure label="Hires" value={r.hires} note={`Offers accepted in ${r.year}`} />
      <Figure label="Time to hire" value={daysFigure(r.timeToHireDays)} note="Applied → offer accepted" />
      <Figure label="Time to fill" value={daysFigure(r.timeToFillDays)} note="Published → offer accepted" />
      <Figure label="Offer acceptance" value={percentFigure(r.offers.acceptanceRate)} note={`${r.offers.accepted} of ${r.offers.accepted + r.offers.declined} answered`} />
      <Figure label="Probation pass rate" value={percentFigure(r.probation.rate)} note={`${r.probation.passed} of ${r.probation.ended} ended`} />
    </div>
  );
}

async function Report({ q }: { q: AnalyticsQuery }) {
  const loaded = await loadAnalytics(q);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'analytics')}</Empty>;
  const r = loaded.value;
  const busiest = Math.max(1, ...r.hiresByMonth.map((m) => m.hires));
  return (
    <div className="space-y-6">
      <Figures r={r} />
      {r.hidden > 0 && <p className="text-xs text-muted">C-level vacancies are left out.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="funnel" className="card overflow-x-auto">
          <h2 id="funnel" className="px-6 pt-5 text-lg font-semibold">
            Funnel
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="text-right">Reached</th>
                <th className="text-right">Of the stage before</th>
              </tr>
            </thead>
            <tbody>
              {r.funnel.map((f) => (
                <tr key={f.stage}>
                  <td>{APPLICATION_STAGE_LABELS[f.stage]}</td>
                  <td className="text-right tabular-nums">{f.reached}</td>
                  <td className="text-right tabular-nums">{percentFigure(f.conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section aria-labelledby="months" className="card space-y-3 p-6">
          <h2 id="months" className="text-lg font-semibold">
            Hires by Month
          </h2>
          <ol className="space-y-1">
            {r.hiresByMonth.map((m) => (
              <li key={m.month} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-muted">{m.month}</span>
                <span className="h-3 rounded bg-accent" style={{ width: `${(m.hires / busiest) * 100}%`, minWidth: m.hires ? '0.5rem' : 0 }} aria-hidden="true" />
                <span className="tabular-nums">{m.hires}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="sources" className="card overflow-x-auto">
          <h2 id="sources" className="px-6 pt-5 text-lg font-semibold">
            Sources
          </h2>
          {r.sources.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted">Nobody applied this year.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="text-right">Applicants</th>
                  <th className="text-right">Shortlisted</th>
                  <th className="text-right">Hired</th>
                </tr>
              </thead>
              <tbody>
                {r.sources.map((s) => (
                  <tr key={s.source}>
                    <td>{APPLICATION_SOURCE_LABELS[s.source]}</td>
                    <td className="text-right tabular-nums">{s.applicants}</td>
                    <td className="text-right tabular-nums">{s.shortlisted}</td>
                    <td className="text-right tabular-nums">{s.hired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section aria-labelledby="departments" className="card overflow-x-auto">
          <h2 id="departments" className="px-6 pt-5 text-lg font-semibold">
            Time to Hire by Department
          </h2>
          {r.departments.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted">No hires this year.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="text-right">Hires</th>
                  <th className="text-right">Time to hire</th>
                </tr>
              </thead>
              <tbody>
                {r.departments.map((d) => (
                  <tr key={d.id ?? 'none'}>
                    <td>{d.name}</td>
                    <td className="text-right tabular-nums">{d.hires}</td>
                    <td className="text-right tabular-nums">{daysFigure(d.timeToHireDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {r.generalCvs && <GeneralCvs g={r.generalCvs} year={r.year} />}
    </div>
  );
}

/** The general CVs of the year (22 October 2026: "what came out of the posted jobs and what cam on randomly"): by source and by month, and how many were added to a vacancy. */
function GeneralCvs({ g, year }: { g: RecruitmentAnalytics['generalCvs']; year: number }) {
  const busiest = Math.max(1, ...g.byMonth.map((m) => m.count));
  return (
    <section aria-labelledby="general-cvs" className="card space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="general-cvs" className="text-lg font-semibold">
          General CVs
        </h2>
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink tabular-nums">{g.received}</span> received in {year} ·{' '}
          <span className="font-semibold text-ink tabular-nums">{g.moved}</span> added to a vacancy
        </p>
      </div>
      {g.received === 0 ? (
        <p className="text-sm text-muted">No general CVs this year.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">CVs</th>
              </tr>
            </thead>
            <tbody>
              {g.bySource.map((s) => (
                <tr key={s.source}>
                  <td>{GENERAL_CV_SOURCE_LABELS[s.source] ?? s.source}</td>
                  <td className="text-right tabular-nums">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ol className="space-y-1" aria-label="General CVs by month">
            {g.byMonth.map((m) => (
              <li key={m.month} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-muted">{m.month}</span>
                <span className="h-3 rounded bg-accent" style={{ width: `${(m.count / busiest) * 100}%`, minWidth: m.count ? '0.5rem' : 0 }} aria-hidden="true" />
                <span className="tabular-nums">{m.count}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

async function Analytics({ searchParams }: { searchParams: PageProps<'/recruitment/analytics'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const today = todayInCairo();
  const q = readAnalyticsQuery(query, today);
  const pickers = await loadPickers();
  const departments = pickers.departments.filter((d) => !d.parentId).sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="analytics-year" className="label">
              Year
            </label>
            <Select id="analytics-year" name="year" defaultValue={String(q.year)} className="input">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="analytics-department" className="label">
              Department
            </label>
            <Select id="analytics-department" name="departmentId" defaultValue={q.departmentId} className="input">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className="btn btn-secondary">
            Show
          </button>
        </form>
        <a href={analyticsExcelHref(q)} className="btn btn-secondary no-underline">
          Download Excel
        </a>
      </div>
      <Suspense fallback={<Loading />}>
        <Report q={q} />
      </Suspense>
    </div>
  );
}

export default function AnalyticsPage({ searchParams }: PageProps<'/recruitment/analytics'>) {
  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold">Recruitment Analytics</h1>
      <Suspense fallback={<Loading />}>
        <Analytics searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
