import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { END_REASON_LABELS, END_REASONS, LEAVER_KIND_LABELS, OFFBOARDING_STATUS_LABELS, REHIRE_LABELS, tenureText } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadFormer, offboardingNotLoaded } from '../../offboarding/data';
import { caseHref, FORMER_EMPLOYEES_PATH, managesOffboarding, OFFBOARDING_PATH, readFormerQuery, REHIRE_STYLE, STATUS_STYLE, type FormerQuery } from '../../offboarding/offboarding';
import { todayInCairo } from '../ui';
import { shownCode } from '@/lib/hidden';

// Former Employees (owner, 21 October 2026, with the Employees list: "when an employee resigns or contract ends with no
// renewal, where will the data be stored? will it be another tab?"; 22 October 2026, the full module): everyone who
// left and doesn't work here now, by their last employment, the latest first: when and why they left (voluntary or
// not), how long they stayed, where and as what, their offboarding case and rehire eligibility. Their profiles keep every
// record. Filtered by the year they left, the reason and the department (with its teams). A C-level person's row has
// their name and dates alone for HR. HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Former Employees · People System' };

function Filters({ q, years, places }: { q: FormerQuery; years: number[]; places: { id: string; label: string }[] }) {
  return (
    <form action={FORMER_EMPLOYEES_PATH} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="former-year" className="label">
          Year left
        </label>
        <Select id="former-year" name="year" defaultValue={q.year ?? ''} className="input min-w-32">
          <option value="">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="former-reason" className="label">
          Reason
        </label>
        <Select id="former-reason" name="reason" defaultValue={q.reason ?? ''} className="input min-w-48">
          <option value="">Any reason</option>
          {END_REASONS.map((r) => (
            <option key={r} value={r}>
              {END_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="former-department" className="label">
          Department or team
        </label>
        <Select id="former-department" name="departmentId" defaultValue={q.departmentId ?? ''} className="input min-w-56">
          <option value="">Every department</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      {(q.year || q.reason || q.departmentId) && (
        <Link href={FORMER_EMPLOYEES_PATH} className="min-h-11 content-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}

async function List({ searchParams }: { searchParams: PageProps<'/employees/former'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!managesOffboarding(user)) return <Empty>Only HR, the CEO and a Super Admin see former employees here. Everyone keeps their profile.</Empty>;
  const q = readFormerQuery(query);
  const [loaded, placesList] = await Promise.all([loadFormer(q), loadPlaces()]);
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'former employees')}</Empty>;
  const rows = loaded.value;
  const thisYear = Number(todayInCairo().slice(0, 4));
  const years = Array.from({ length: 8 }, (_, i) => thisYear - i);
  const places = placesList
    .filter((p) => p.parentId === null)
    .flatMap((d) => [{ id: d.id, label: d.nameEn }, ...placesList.filter((t) => t.parentId === d.id).map((t) => ({ id: t.id, label: `${d.nameEn} › ${t.nameEn}` }))]);
  return (
    <div className="space-y-4">
      <Filters q={q} years={years} places={places} />
      {rows.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">Nobody here{q.year || q.reason || q.departmentId ? ' with these filters' : ' yet'}.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Left</th>
                <th>Reason</th>
                <th>Stayed</th>
                <th>Was</th>
                <th>Clearance</th>
                <th>Rehire</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employmentId}>
                  <td>
                    <Link href={`/employees/${r.employee.id}`} className="font-semibold">
                      {r.employee.fullNameEn}
                    </Link>
                    {shownCode(r.employee.employeeCode) && <div className="text-xs text-muted">{r.employee.employeeCode}</div>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(r.endDate)}</td>
                  {r.restricted ? (
                    <td colSpan={5} className="text-muted">
                      C-level: the CEO and a Super Admin see the rest.
                    </td>
                  ) : (
                    <>
                      <td>
                        {r.endReason ? (END_REASON_LABELS[r.endReason as keyof typeof END_REASON_LABELS] ?? r.endReason) : '—'}
                        <div className="text-xs text-muted">{LEAVER_KIND_LABELS[r.leaverKind]}</div>
                      </td>
                      <td className="whitespace-nowrap">{tenureText(r.tenureMonths)}</td>
                      <td>
                        {r.jobTitle ?? '—'}
                        {r.department && <div className="text-xs text-muted">{r.department}</div>}
                      </td>
                      <td>
                        {r.caseId && r.clearance ? (
                          <Link href={caseHref(r.caseId)} className={`badge no-underline ${STATUS_STYLE[r.clearance]}`}>
                            {OFFBOARDING_STATUS_LABELS[r.clearance]}
                          </Link>
                        ) : (
                          <span className="text-muted">No case</span>
                        )}
                      </td>
                      <td>{r.rehire ? <span className={`badge ${REHIRE_STYLE[r.rehire]}`}>{REHIRE_LABELS[r.rehire]}</span> : <span className="text-muted">Not set</span>}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function FormerEmployeesPage({ searchParams }: PageProps<'/employees/former'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Former Employees</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Everyone who left and doesn&apos;t work here now, the latest first. Their profiles keep every record: employment, contracts, payslips, leave and
            documents. Open a case to see their clearance, exit interview and rehire eligibility.
          </p>
        </div>
        <Link href={OFFBOARDING_PATH} className="btn btn-secondary no-underline">
          Offboarding
        </Link>
      </div>
      <Suspense fallback={<Loading />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
