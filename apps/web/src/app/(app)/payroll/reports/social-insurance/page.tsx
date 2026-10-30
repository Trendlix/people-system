import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  confidentialExcludedNote,
  siPlaceParts,
  type SiContributionsReport,
  type SiMissingReport,
  type SiMonthRow,
  type SiPlace,
  type SiRegisterReport,
  type SiRegisterRow,
} from '@trendlix/shared';
import { Hidden, Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { departmentOptions } from '@/lib/departments';
import { formatDate, formatDateTime } from '@/lib/format';
import { employmentHidden, filtersByJob } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { Department } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { ProfileTabs } from '../../../employees/[id]/profile-tabs';
import { BackLink, Empty, Loading, todayInCairo } from '../../../employees/ui';
import { StaffOnly } from '../../../staff-only';
import { monthName } from '../../list';
import { loadJson, type Loaded } from '../../load';
import { monthChoices } from '../salary-raises/salary-raises';
import { VS_INSURANCE_PATH } from '../vs-insurance/vs-insurance';
import {
  apiReportPath,
  basicText,
  bothShares,
  canSeeSocialInsurance,
  comprehensiveText,
  contributionTiles,
  excelHref,
  formText,
  insuranceTabHref,
  insuredText,
  leftText,
  limitsText,
  marksText,
  missingLinks,
  missingTiles,
  peopleLabel,
  printText,
  readFilters,
  registerTiles,
  reportHref,
  seesMissingData,
  shareHeads,
  shareText,
  standingText,
  startText,
  stateTone,
  STATUS_OPTIONS,
  viewTabs,
  type Shown as ShownValue,
  type SiFilters,
  type Tile,
} from './social-insurance';

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; asked which, he chose all three: "Insured staff register", "Monthly contributions" and "Missing
// data checklist"), under Payroll → Reports beside Payroll vs Social Insurance. One page, the three views as tabs, the view
// and its filters in the address so a view can be shared, each with its Excel download (the API's workbook, passed on
// under the web domain by excel/route.ts):
// - Register: one row per person registered with social insurance (current employees unless the status asks for others,
//   leavers among them): the insurance number, the national ID (masked; in full in HR's and the CEO's workbook), the
//   occupation, the subscription start, the basic, comprehensive and insured wages, both shares a month on this year's
//   rates, and where Forms 1 and 6 and the print stand; filtered by department or team and status.
// - Monthly contributions: for a month, everyone registered employed in it, the insured wage and the whole month's shares,
//   joiners and leavers marked, and the totals to pay the insurance office.
// - Missing data: who misses something on their Social Insurance tab, in words, each linked to where it is filled in.
// Everything comes from each profile's Social Insurance tab, never a payroll run: the page says so, and links the report
// that compares the two. Salary data for HR, Finance and the CEO; the missing data (the employee file's forms and print)
// for HR and the CEO; the API checks it again. The C-level people are left out for anyone but the CEO and the Super Admin
// (owner, 19 October 2026: "make C level Employees details not visible to HR"), and the page says how many. A developer
// sees the figures masked by the API, and no filter by place.

export const metadata: Metadata = { title: 'Social Insurance Report · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR, Finance and the CEO can see the social insurance report.';
const MISSING_NOT_ALLOWED = 'Only HR and the CEO see the missing data: it lists the employee file’s forms and print.';
const dash = <span className="text-muted">—</span>;
const num = 'whitespace-nowrap text-right tabular-nums';
const TONE = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', accent: 'bg-accent-soft text-accent', muted: 'bg-line-soft text-muted' } as const;

function FilterSelect({ id, name, label, value, options }: { id: string; name: string; label: string; value: string; options: readonly { value: string; label: string }[] }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value} className="input w-full sm:min-w-48">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** The view's filters (department or team; the register's status, the month's month), Show, and the Excel download. */
function Filters({ f, today, departments, note }: { f: SiFilters; today: string; departments: readonly { id: string; label: string }[] | null; note: string }) {
  const months = monthChoices(today, { from: f.month, to: f.month });
  return (
    <section className="card space-y-4 p-4">
      {/* keyed by the address, so following a tab shows its own filters, not what was chosen before */}
      <form key={reportHref(f, today)} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={f.view} />
        {/* a developer's filter by place doesn't apply (22 October 2026: "Hide per-person details"): not offered */}
        {departments && (
          <FilterSelect
            id="si-department"
            name="department"
            label="Department or team"
            value={f.department ?? ''}
            options={[{ value: '', label: 'Everyone' }, ...departments.map((d) => ({ value: d.id, label: d.label }))]}
          />
        )}
        {f.view === 'register' && <FilterSelect id="si-status" name="status" label="Status" value={f.status} options={STATUS_OPTIONS} />}
        {f.view === 'contributions' && <FilterSelect id="si-month" name="month" label="Month" value={f.month} options={months} />}
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="hint max-w-3xl">{note}</p>
        {/* a plain link, never prefetched: the API makes the workbook on each download */}
        <a href={excelHref(f, today)} className="btn btn-secondary">
          Download Excel
        </a>
      </div>
    </section>
  );
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.key} className="card px-4 py-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{t.value}</dd>
          {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ id, title, note }: { id: string; title: string; note?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

/** A figure, and where it came from when it isn't the employee's own ("· default"); `none` when there is none. */
function Value({ shown, none = dash }: { shown: ShownValue; none?: React.ReactNode }) {
  if (!shown) return <>{none}</>;
  return (
    <>
      <span className="tabular-nums">{shown.text}</span>
      {shown.from && <div className="text-xs text-muted">{shown.from}</div>}
    </>
  );
}

/** The person, linked to their Social Insurance tab, with their code and what else is said under the name. */
function Person({ row, children }: { row: { employee: { id: string; fullNameEn: string; employeeCode: string } }; children?: React.ReactNode }) {
  return (
    <td className="min-w-44">
      <Link href={insuranceTabHref(row)} className="font-semibold">
        {row.employee.fullNameEn}
        <span className="sr-only"> (Social Insurance tab)</span>
      </Link>
      <div className="text-xs tabular-nums text-muted">
        <Shown text={row.employee.employeeCode} />
      </div>
      {children}
    </td>
  );
}

/** Where someone works: the department, the team under it. */
function Place({ department }: { department: SiPlace | null }) {
  const p = siPlaceParts(department);
  return (
    <td className="min-w-32">
      <Shown text={p.department} empty={dash} />
      {p.team && (
        <div className="text-xs text-muted">
          <Shown text={p.team} />
        </div>
      )}
    </td>
  );
}

function Badge({ state, text }: { state: Parameters<typeof stateTone>[0] | null; text: string | null }) {
  if (!state || !text) return dash;
  return <span className={`badge whitespace-nowrap ${TONE[stateTone(state)]}`}>{text}</span>;
}

/** What a view couldn't load, in its place. */
function NotLoaded({ loaded, what }: { loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>; what: string }) {
  return (
    <Empty>
      {loaded.kind === 'unavailable'
        ? 'Not available yet: the server does not have this report yet.'
        : loaded.kind === 'forbidden'
          ? NOT_ALLOWED
          : `The ${what} could not be loaded. ${loaded.messages.join(' ')}`}
    </Empty>
  );
}

// ---------- the register ----------

function RegisterRow({ row: r, report, today }: { row: SiRegisterRow; report: SiRegisterReport; today: string }) {
  // a developer gets the type "••••" and no dates (22 October 2026: "Hide per-person details", "and the social insurance")
  const hidden = employmentHidden(r);
  const left = leftText(r, today);
  return (
    <tr className="align-top">
      <Person row={r}>
        <div className="text-xs text-muted">
          {standingText(r.standing)}
          {left && ` · ${left}`}
        </div>
      </Person>
      <Place department={r.department} />
      <td className="whitespace-nowrap tabular-nums">
        <Shown text={r.insuranceNo} empty={<span className="text-warn">Not set</span>} />
      </td>
      {report.seesIdentity && <td className="whitespace-nowrap tabular-nums">{r.nationalId ?? dash}</td>}
      <td className="min-w-48">
        {r.occupationCode ? (
          <>
            <span className="tabular-nums">
              <Shown text={r.occupationCode} />
            </span>
            {r.occupationName && (
              <div lang="ar" dir="rtl" className="text-right text-xs text-muted">
                {r.occupationName}
              </div>
            )}
          </>
        ) : hidden ? (
          <Hidden />
        ) : (
          <span className="text-warn">Not set</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        <Value shown={startText(r)} none={hidden ? <Hidden /> : dash} />
      </td>
      <td className={num}>
        <Value shown={basicText(r)} />
      </td>
      <td className={num}>
        <Value shown={comprehensiveText(r)} />
      </td>
      <td className={num}>
        <Value shown={insuredText(r)} none={<span className="text-warn">None</span>} />
      </td>
      <td className={num}>{shareText(r.employeeInsurance) ?? dash}</td>
      <td className={num}>{shareText(r.employerInsurance) ?? dash}</td>
      {report.seesFile && (
        <>
          <td>
            <Badge state={r.form1} text={formText(r.form1)} />
          </td>
          <td>
            <Badge state={r.form6} text={formText(r.form6)} />
          </td>
          <td>
            <Badge state={r.print} text={printText(r)} />
          </td>
        </>
      )}
    </tr>
  );
}

async function RegisterView({ f, today, departments }: { f: SiFilters; today: string; departments: readonly { id: string; label: string }[] | null }) {
  const loaded = await loadJson<SiRegisterReport>(apiReportPath(f, today));
  const filters = (
    <Filters
      f={f}
      today={today}
      departments={departments}
      note="Everyone registered with social insurance on their Social Insurance tab. The insured wage is the comprehensive wage within this year’s insurable limits, and the shares are a whole month’s."
    />
  );
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {filters}
        <NotLoaded loaded={loaded} what="social insurance register" />
      </div>
    );
  }
  const report = loaded.value;
  const heads = shareHeads(report.rates);
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'details');
  const t = report.totals;
  // the total's label spans the person, the place, the insurance number, the national ID, the occupation, the start and
  // the basic and comprehensive wages; the insured wage and both shares are summed
  const lead = (report.seesIdentity ? 6 : 5) + 2;
  return (
    <div className="space-y-6">
      {filters}
      <section aria-labelledby="si-register" className="space-y-3">
        <SectionTitle id="si-register" title="Insured Staff Register" note={`As of ${formatDateTime(report.generatedAt)}; ${limitsText(report.rates)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        <Tiles tiles={registerTiles(report)} />
        {report.rows.length === 0 ? (
          <Empty>No one registered with social insurance matches these filters.</Empty>
        ) : (
          // the table scrolls inside its card on a narrow screen, the page doesn't
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Insurance No.</th>
                  {report.seesIdentity && <th scope="col">National ID</th>}
                  <th scope="col">Occupation</th>
                  <th scope="col">Subscription Start</th>
                  <th scope="col" className="text-right">
                    Basic Wage
                  </th>
                  <th scope="col" className="text-right">
                    Comprehensive Wage
                  </th>
                  <th scope="col" className="text-right">
                    Insured Wage
                  </th>
                  <th scope="col" className="text-right">
                    {heads.employee}
                  </th>
                  <th scope="col" className="text-right">
                    {heads.employer}
                  </th>
                  {report.seesFile && (
                    <>
                      <th scope="col">Form 1</th>
                      <th scope="col">Form 6</th>
                      <th scope="col">Print</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <RegisterRow key={r.employmentId} row={r} report={report} today={today} />
                ))}
                <tr className="border-t-2 border-line bg-canvas font-semibold">
                  <th scope="row" colSpan={lead} className="text-left text-sm tracking-normal text-ink normal-case">
                    Total · {peopleLabel(t.people)}
                  </th>
                  <td className={num}>{shareText(t.insuredWage)}</td>
                  <td className={num}>{shareText(t.employeeInsurance)}</td>
                  <td className={num}>{shareText(t.employerInsurance)}</td>
                  {report.seesFile && <td colSpan={3} />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {!report.seesIdentity && <p className="text-xs text-muted">The national ID, and Forms 1 and 6 and the print in the employee file, are for HR and the CEO.</p>}
      </section>
    </div>
  );
}

// ---------- the monthly contributions ----------

function MonthRow({ row: r, month }: { row: SiMonthRow; month: string }) {
  const marks = marksText(r, month);
  return (
    <tr className="align-top">
      <Person row={r}>{marks && <span className={`badge mt-1 ${marks === 'Joined' ? TONE.accent : TONE.warn}`}>{marks}</span>}</Person>
      <Place department={r.department} />
      <td className="whitespace-nowrap tabular-nums">
        <Shown text={r.insuranceNo} empty={<span className="text-warn">Not set</span>} />
      </td>
      <td className={num}>
        <Value shown={insuredText(r)} none={<span className="text-warn">None</span>} />
      </td>
      <td className={num}>{shareText(r.employeeInsurance) ?? dash}</td>
      <td className={num}>{shareText(r.employerInsurance) ?? dash}</td>
      <td className={`${num} font-semibold`}>{shareText(bothShares(r)) ?? dash}</td>
    </tr>
  );
}

async function ContributionsView({ f, today, departments }: { f: SiFilters; today: string; departments: readonly { id: string; label: string }[] | null }) {
  const loaded = await loadJson<SiContributionsReport>(apiReportPath(f, today));
  const filters = (
    <Filters
      f={f}
      today={today}
      departments={departments}
      note="What the Social Insurance tab says for the month: everyone registered employed in it, joiners and leavers too, on the whole month’s shares. Payroll vs Social Insurance compares it with the payroll."
    />
  );
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {filters}
        <NotLoaded loaded={loaded} what="monthly contributions" />
      </div>
    );
  }
  const report = loaded.value;
  const heads = shareHeads(report.rates);
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'details');
  const t = report.totals;
  return (
    <div className="space-y-6">
      {filters}
      <section aria-labelledby="si-contributions" className="space-y-3">
        <SectionTitle id="si-contributions" title={`Contributions for ${monthName(report.month)}`} note={`As of ${formatDateTime(report.generatedAt)}; ${limitsText(report.rates)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        {(report.notRegistered > 0 || report.insureEveryone) && (
          <p className="text-sm text-muted">
            {report.notRegistered > 0 && `${report.notRegistered} employed under the labour law in ${monthName(report.month)} ${report.notRegistered === 1 ? 'isn’t' : 'aren’t'} registered, so ${report.notRegistered === 1 ? 'isn’t' : 'aren’t'} listed. `}
            {report.insureEveryone && 'Payroll counts everyone under the labour law as insured, registered or not (Payroll Setup): '}
            {report.insureEveryone && <Link href={VS_INSURANCE_PATH}>compare with the payroll</Link>}
            {report.insureEveryone && '.'}
          </p>
        )}
        <Tiles tiles={contributionTiles(report)} />
        {report.rows.length === 0 ? (
          <Empty>No one registered with social insurance was employed in {monthName(report.month)}.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Insurance No.</th>
                  <th scope="col" className="text-right">
                    Insured Wage
                  </th>
                  <th scope="col" className="text-right">
                    {heads.employee}
                  </th>
                  <th scope="col" className="text-right">
                    {heads.employer}
                  </th>
                  <th scope="col" className="text-right">
                    Both Shares
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <MonthRow key={r.employmentId} row={r} month={report.month} />
                ))}
                <tr className="border-t-2 border-line bg-canvas font-semibold">
                  <th scope="row" colSpan={3} className="text-left text-sm tracking-normal text-ink normal-case">
                    Total to pay the insurance office
                  </th>
                  <td className={num}>{shareText(t.insuredWage)}</td>
                  <td className={num}>{shareText(t.employeeInsurance)}</td>
                  <td className={num}>{shareText(t.employerInsurance)}</td>
                  <td className={num}>{shareText(t.toPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- the missing data ----------

async function MissingView({ f, today, departments }: { f: SiFilters; today: string; departments: readonly { id: string; label: string }[] | null }) {
  const loaded = await loadJson<SiMissingReport>(apiReportPath(f, today));
  const filters = (
    <Filters
      f={f}
      today={today}
      departments={departments}
      note="Current full-time employees, and part-timers registered with social insurance, missing something on their Social Insurance tab. Each item links to where it is filled in."
    />
  );
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {filters}
        {loaded.kind === 'forbidden' ? <Empty>{MISSING_NOT_ALLOWED}</Empty> : <NotLoaded loaded={loaded} what="missing data" />}
      </div>
    );
  }
  const report = loaded.value;
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'details');
  return (
    <div className="space-y-6">
      {filters}
      <section aria-labelledby="si-missing" className="space-y-3">
        <SectionTitle id="si-missing" title="Missing Data" note={`As of ${formatDateTime(report.generatedAt)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        <Tiles tiles={missingTiles(report)} />
        {report.rows.length === 0 ? (
          <Empty>Nothing is missing: every Social Insurance tab checked is complete.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Missing</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.employmentId} className="align-top">
                    <Person row={r} />
                    <Place department={r.department} />
                    <td className="whitespace-nowrap">{standingText(r.standing)}</td>
                    <td className="whitespace-nowrap tabular-nums">{r.joinDate ? formatDate(r.joinDate) : <Hidden />}</td>
                    <td className="min-w-64">
                      <ul className="flex flex-wrap gap-1.5">
                        {missingLinks(r).map((m) => (
                          <li key={m.key}>
                            <Link href={m.href} className={`badge ${TONE.warn} no-underline hover:underline`}>
                              {m.label}
                              <span className="sr-only"> for {r.employee.fullNameEn}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- the page ----------

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeSocialInsurance(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const today = todayInCairo();
  const f = readFilters(query, today);
  const missing = seesMissingData(user);
  const list = filtersByJob(user) ? await getOrNull<Department[]>('/departments') : null;
  const departments = list && departmentOptions(list);
  const tabs = viewTabs(f, today, missing);
  // the missing data asked for by someone who doesn't see it: the tab isn't offered, the address says why
  const view =
    f.view === 'missing' && !missing ? (
      <Empty>{MISSING_NOT_ALLOWED}</Empty>
    ) : f.view === 'missing' ? (
      <MissingView f={f} today={today} departments={departments} />
    ) : f.view === 'contributions' ? (
      <ContributionsView f={f} today={today} departments={departments} />
    ) : (
      <RegisterView f={f} today={today} departments={departments} />
    );
  return (
    <ProfileTabs tabs={tabs} active={tabs.some((t) => t.key === f.view) ? f.view : 'register'} label="Social insurance report">
      {view}
    </ProfileTabs>
  );
}

export default function SocialInsurancePage({ searchParams }: PageProps<'/payroll/reports/social-insurance'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/payroll/reports">Payroll Reports</BackLink>
        <div>
          <h1 className="page-title">Social Insurance</h1>
          <p className="mt-1 text-muted">
            From each employee&rsquo;s Social Insurance tab: who is registered and on what wage, a month&rsquo;s contributions to pay the insurance office, and what
            is still missing. It shows what the tab says, not a payroll run: <Link href={VS_INSURANCE_PATH}>Payroll vs Social Insurance</Link> compares the two.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
