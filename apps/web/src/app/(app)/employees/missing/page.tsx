import Link from 'next/link';
import { Suspense } from 'react';
import { DepartmentOptions } from '@/components/department-options';
import { Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { ApiError, apiGet } from '@/lib/api';
import { departmentName, withTeams } from '@/lib/departments';
import { formatDateTime } from '@/lib/format';
import { filtersByJob, shownCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { Department, ProfileGap } from '@/lib/types';
import { StaffOnly } from '../../staff-only';
import { BackLink, canSeeEmployeeFiles, Empty, Loading, profileHref, StandingBadge } from '../ui';
import {
  bySection,
  confidentialExcludedText,
  documentGaps,
  EXCEL_HREF,
  gapHref,
  inView,
  isFiltered,
  listed,
  missingHref,
  personalGaps,
  readFilters,
  summaryText,
  WHAT_FILTERS,
  type MissingDetailsReport,
  type MissingDetailsRow,
  type MissingFilters,
} from './missing-details';

// The Missing Details report (owner's request, 16 October 2026: "i want to generate a report with the missing personal
// profile fields and documents"), for HR and the CEO, who see the employee file whose papers it lists. One GET
// /employees/missing call, with the same checklist as each profile's header; filtered here from the address (a search,
// the department with its teams, what is missing, and whether people not employed yet are listed), so a view can be
// shared. Former employees are never on it. Each missing item links to where it is filled in on the profile. The Excel
// workbook is the API's, passed on under the web domain (excel/route.ts). The C-level people are left out for anyone but
// the CEO and the Super Admin (owner, 19 October 2026: "make C level Employees details not visible to HR"), the workbook
// too, and the page says so.

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR and the CEO can see which details are missing from the employee files.';
const dash = <span className="text-muted">—</span>;
const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';
const choice =
  'flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';
const gapChip = 'inline-block rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn no-underline hover:text-warn hover:underline';

function Filters({ filters: f, departments, byJob }: { filters: MissingFilters; departments: Department[]; byJob: boolean }) {
  return (
    // keyed by the filters, so following a link to other filters (Clear) shows them, not what was typed before
    <form key={missingHref(f)} className="flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-56 flex-1">
        <label htmlFor="missing-search" className="label">
          Search
        </label>
        <input id="missing-search" name="q" type="search" maxLength={100} defaultValue={f.q} placeholder="Name or employee code" className="input" />
      </div>
      {/* not for a developer, who isn't shown where people work (owner, 22 October 2026: "Hide per-person details") */}
      {byJob && (
        <div>
          <label htmlFor="missing-department" className="label">
            Department
          </label>
          <Select id="missing-department" name="departmentId" defaultValue={f.departmentId} className="input min-w-56">
            <option value="">All departments</option>
            <DepartmentOptions departments={departments} />
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="missing-what" className="label">
          What is missing
        </label>
        <Select id="missing-what" name="what" defaultValue={f.what} className="input min-w-44">
          {WHAT_FILTERS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </div>
      <label className={choice}>
        <input type="checkbox" name="notEmployed" value="1" defaultChecked={f.notEmployed} className="size-4 accent-accent" />
        Include people not employed yet
      </label>
      <button type="submit" className="btn btn-secondary">
        Search
      </button>
      {isFiltered(f) && (
        <Link href="/employees/missing" className="btn btn-secondary">
          Clear
        </Link>
      )}
    </form>
  );
}

/** The percent with a meter, as the profile's header shows it. */
function Completeness({ percent }: { percent: number }) {
  return (
    <div className="flex min-w-32 items-center gap-2">
      <span aria-hidden="true" className="block h-2 w-20 shrink-0 overflow-hidden rounded-full bg-line-soft">
        <span className={`block h-full rounded-full ${percent === 100 ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="text-sm font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}

/** Missing items as chips, each linking to where it is filled in on the profile. */
function GapChips({ employeeId, gaps }: { employeeId: string; gaps: ProfileGap[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {gaps.map((gap) => (
        <li key={gap.key}>
          <Link href={gapHref(employeeId, gap)} className={gapChip}>
            {gap.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ row: r }: { row: MissingDetailsRow }) {
  const personal = personalGaps(r.missing);
  const papers = documentGaps(r.missing);
  return (
    <tr>
      <td className="align-top">
        <Link href={profileHref(r.id)} className="font-semibold">
          {r.fullNameEn}
        </Link>
        {shownCode(r.employeeCode) && <div className="text-xs text-muted tabular-nums">{r.employeeCode}</div>}
        {r.standing === 'not_employed' && (
          <div className="mt-1">
            <StandingBadge standing={r.standing} />
          </div>
        )}
      </td>
      <td className="align-top">{r.department ? <Shown text={departmentName(r.department)} /> : dash}</td>
      <td className="align-top">{r.jobTitle ? <Shown text={r.jobTitle.titleEn} /> : dash}</td>
      <td className="align-top">
        <Completeness percent={r.percent} />
      </td>
      <td className="min-w-72 align-top">
        {personal.length === 0
          ? dash
          : bySection(personal).map((s) => (
              <div key={s.tab} className="mb-1.5 last:mb-0">
                <div className="mb-0.5 text-xs font-medium text-muted">{s.label}</div>
                <GapChips employeeId={r.id} gaps={s.gaps} />
              </div>
            ))}
      </td>
      <td className="min-w-56 align-top">{papers.length === 0 ? dash : <GapChips employeeId={r.id} gaps={papers} />}</td>
    </tr>
  );
}

/** What the table says when it lists no one. */
function nothingListed(f: MissingFilters): string {
  if (f.what === 'personal') return 'No personal details are missing.';
  if (f.what === 'documents') return 'No documents are missing.';
  return 'Nothing is missing. Every profile is complete.';
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeEmployeeFiles(user)) return <Empty>{NOT_ALLOWED}</Empty>;

  let report: MissingDetailsReport;
  let departments: Department[];
  try {
    [report, departments] = await Promise.all([apiGet<MissingDetailsReport>('/employees/missing'), apiGet<Department[]>('/departments')]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return <Empty>{NOT_ALLOWED}</Empty>;
    throw err;
  }

  // a developer's list is never narrowed by department: it is hidden from them (22 October 2026)
  const byJob = filtersByJob(user);
  const f = byJob ? readFilters(query) : { ...readFilters(query), departmentId: '' };
  const people = inView(report.rows, f, f.departmentId ? withTeams(departments, f.departmentId) : null);
  const rows = listed(people, f.what);
  const summary = summaryText(people);
  const excluded = confidentialExcludedText(report.confidentialExcluded);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="font-medium">{summary || 'No one to show.'}</p>
          <p className="mt-0.5 text-xs text-muted">As of {formatDateTime(report.generatedAt)}</p>
          {excluded && <p className="mt-0.5 text-sm text-muted">{excluded}</p>}
        </div>
        <div className="text-right">
          {/* a plain link, never prefetched: the API makes the workbook on each download */}
          <a href={EXCEL_HREF} className="btn btn-secondary">
            Download Excel
          </a>
          <p className="hint">Everyone with something missing, people not employed yet too.</p>
        </div>
      </section>

      <section className="card">
        <Filters filters={f} departments={departments} byJob={byJob} />
        {people.length === 0 ? (
          <p className={quiet}>
            {isFiltered(f) ? (
              <>
                No one matches these filters. <Link href="/employees/missing">Clear filters</Link>
              </>
            ) : (
              'No current employees yet.'
            )}
          </p>
        ) : rows.length === 0 ? (
          <p className={quiet}>{nothingListed(f)}</p>
        ) : (
          <>
            <div className="overflow-x-auto border-t border-line">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Job Title</th>
                    <th>Complete</th>
                    <th>Missing Personal Details</th>
                    <th>Missing Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <PersonRow key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-3 text-sm text-muted">
              Showing {rows.length} {rows.length === 1 ? 'person' : 'people'}, least complete first
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export default function MissingDetailsPage({ searchParams }: PageProps<'/employees/missing'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/employees">Employees</BackLink>
        <div>
          <h1 className="page-title">Missing Details</h1>
          <p className="mt-1 text-muted">The personal details and documents each profile still lacks, by the same checklist as the profile.</p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
