import Link from 'next/link';
import { Suspense } from 'react';
import { CONTRACT_STATUS_LABELS, END_REASON_LABELS, LABELS, seesRaiseRequests } from '@trendlix/shared';
import { ApiError, apiGet } from '@/lib/api';
import { Shown } from '@/components/hidden';
import { DECIDES_NOTE, leadRows } from '@/lib/department-leads';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { employmentHidden, isHidden, joinShown, labelOf } from '@/lib/hidden';
import { canDelete, hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Contract, EmployeeProfile, Employment, Grade, SessionUser } from '@/lib/types';
import { canSeePayroll } from '../../payroll/list';
import { loadEmployeeRaiseRequests, type EmployeeRaiseRequestsLoad } from '../../raise-requests/data';
import { showsRaiseRequests } from '../../raise-requests/list';
import { deleteEmployment } from '../employment-actions';
import { outsideLawShort, typeWord, workNatureLabel, workPatternNote } from '../employment-law';
import { LawWarningBadges } from '../law-badges';
import { openSubTab, visibleSubTabs } from '../tab-list';
import {
  arrangementLabel,
  canSeeEmployeeFiles,
  employmentHref,
  FieldGrid,
  gradeLabel,
  periodLabel,
  ProfileSection,
  profileHref,
  reportStanding,
  shiftLabel,
  StandingBadge,
  StatusBadge,
  todayInCairo,
  type GridField,
} from '../ui';
import { AnchorSubTab } from './anchor-sub-tab';
import { ContractSection, ContractSectionLoading, termLabel } from './contracts/contract-section';
import { loadContracts } from './contracts/data';
import { ProbationBanner } from './contracts/probation-banner';
import { GeneratedDocuments, GeneratedDocumentsLoading } from './documents/document-rows';
import { EndingPanel } from './ending/ending-panel';
import { CheckInExemptionSection } from './check-in-exemption';
import { ClientAccountsSection } from './client-accounts/client-accounts-section';
import { CheckInPlacesLine } from './check-in-places';
import { HomeLocationLine } from './home-location';
import { DeleteRowButton } from './inline-forms';
import { LeaveSection } from './leave/leave-section';
import { PayReceived, PayReceivedLoading } from './payslips/pay-received';
import { ProfileTabs } from './profile-tabs';
import { RaiseRequestsSection } from './raise-requests/raise-requests-section';
import { hasPlans } from './advances/advances';
import { AdvancesLoading, AdvancesSection, loadDeductionPlans } from './advances/advances-section';
import { SalaryHistoryLoading, SalaryHistorySection } from './salary-history/salary-history-section';
import { seesTemplates } from '../../organization/templates/wording';

// The Employment tab: everything about the job, in one place (owner, 16 October 2026: "there is no point of adding
// employment then adding contract and no active employment without a contract, its like a loop for me"; the Contracts
// tab was merged into it), in sub-tabs (owner, 17 October 2026: "move the salary history from the employment tab, it
// looks very busy now, or make subtabs"; the owner chose sub-tabs). The open one is in the address (&sub=, none for
// Details), so it survives a reload, and only it is rendered, each section loading on its own as before:
// - Details, for everyone who sees the profile: the probation banner and an ending in progress; the current employment
//   (Edit, End employment) with its contract (#contract: the signed version, a draft or a raise to sign, Renew, Raise,
//   the filing dates), or a way to hire, which takes the job and the contract's terms in one form; every employment in
//   the history, newest first, with its contracts; the leave (#leave: owner, 18 October 2026, "can you apply the
//   leaves according to the law?"), the annual balance of a year with what is left of the other types and the year's
//   requests, for HR, the CEO, Finance, the employee and their manager, HR adjusting the balance and recording leave;
//   the people who report to this person now.
// - Salary: the Salary History (#salary-history: each employment's pay events, with what the Pay History table had)
//   and the pay received with the payslips (#payslips), HR's, Finance's and the CEO's, as the salary; between them the
//   Raise Requests (#raise-requests), the person's requests with each decision and log, read only (asked for and
//   decided under Requests → Raise Requests since 17 October 2026, Request a raise opening the form there); then the advances and loans with what is outstanding (#advances: owner, 17 October 2026),
//   as the salary, which became Loans and Deductions on 18 October 2026 (owner: "in the deductions i might have a loan
//   of a medical subscription or something that needs to be deducted as installments on the employee. how will it be
//   managed?"): the open advances and loans with the next installment, and the recurring deductions, which the employee
//   sees on their own profile too. The API sends each viewer only what they may see: the employee and their manager get
//   only the requests (the employee, their own plans), so they are offered Salary only when there is something there
//   for them. Since 20 October 2026 (owner: "raises not to be visible to employee level for now", then "Hide from
//   managers too") the Raise Requests only for those who see raise requests (seesRaiseRequests, packages/shared
//   raises.ts): the employee and their manager get no requests at all, their own included, so Salary is the employee's
//   loans and deductions alone.
// - Issued Documents, HR's and the CEO's: the documents generated from the templates (#contract-documents), which HR
//   generates and moves along and the CEO views and downloads; not the Documents tab, the papers the employee brings.
// Links from before the sub-tabs name only an anchor (?tab=employment#payslips): AnchorSubTab moves them to the sub-tab
// holding it. HR changes employments and contracts, confirms probation and records endings; the CEO approves or rejects
// endings here; only a Super Admin may delete an employment added by mistake (the API checks all of it again). The
// social insurance work is on its own tab.

const dash = <span className="text-muted">—</span>;
const small = 'btn min-h-9 px-3';

/** "Marketing › Content Team", or a department itself (e.g. for Head of Marketing, a title of the department's own). */
const placeLabel = (e: Employment) => (employmentHidden(e) ? 'Department or team' : e.department && !e.department.parent ? 'Department' : 'Team');

/**
 * The current employment's details, in the profile's field grid. Its team, job title, grade, shift and manager count in
 * the profile's completeness (the manager except for the top grade, who reports to nobody), so they are Required. After
 * the manager, the people in charge of where they work (owner, 19 October 2026: "i want to add department lead person,
 * the person in charge"): their team's Team lead and their department's Head of department, the one who decides their
 * leave and claims when they have no direct manager saying so.
 */
function employmentFields(e: Employment, linkPeople: boolean, topGrade: boolean): GridField[] {
  const grade = e.grade; // the person's own grade in this employment (within the job title's range, if it has one)
  // a developer gets none of the job's details (owner, 22 October 2026: "Hide per-person details"): each shows Hidden
  const hidden = employmentHidden(e);
  return [
    {
      key: 'employmentType',
      label: 'Employment type',
      value: labelOf(LABELS.employmentType, e.employmentType),
      // by the labour law (18 October 2026): Sales became Full-time paid by commission; freelance is outside the law, and
      // the unpaid internship (19 October 2026)
      note: e.paidByCommission ? 'Paid by commission' : outsideLawShort(e.employmentType),
    },
    // an intern's Active shows as Intern (19 October 2026)
    { key: 'status', label: 'Status', value: <StatusBadge status={e.status} employmentType={e.employmentType} /> },
    { key: 'team', label: placeLabel(e), value: e.department && departmentName(e.department), required: true },
    {
      key: 'jobTitle',
      label: 'Job title',
      value: e.jobTitle?.titleEn,
      required: true,
      note: e.jobTitle?.titleAr && !isHidden(e.jobTitle.titleAr) && (
        <span lang="ar" dir="rtl">
          {e.jobTitle.titleAr}
        </span>
      ),
    },
    {
      key: 'grade',
      label: 'Grade',
      value: grade && gradeLabel(grade),
      required: true,
      note: grade?.levelAr && !isHidden(grade.levelAr) && (
        <span lang="ar" dir="rtl">
          {grade.levelAr}
        </span>
      ),
    },
    {
      key: 'manager',
      label: 'Direct manager',
      value: e.manager && (linkPeople ? <Link href={`/employees/${e.manager.id}`}>{e.manager.fullNameEn}</Link> : e.manager.fullNameEn),
      required: !topGrade,
    },
    ...leadRows(e).map(
      (row): GridField => ({
        key: row.key,
        label: row.label,
        value: row.person && (linkPeople ? <Link href={`/employees/${row.person.id}`}>{row.person.fullNameEn}</Link> : row.person.fullNameEn),
        note: row.decides ? DECIDES_NOTE : undefined,
      }),
    ),
    { key: 'joinDate', label: 'Join date', value: formatDate(e.joinDate), hidden },
    { key: 'probationEnd', label: 'Probation end date', value: formatDate(e.probationEnd), hidden },
    { key: 'workArrangement', label: 'Work arrangement', value: arrangementLabel(e), note: workPatternNote(e.workArrangement), hidden },
    // the nature of the work (Labour Law Art. 1(6–8)), from an API that has it, with casual work past its 6 months warned
    ...(e.workNature !== undefined
      ? [
          {
            key: 'workNature',
            label: 'Nature of the work',
            hidden,
            value: (
              <span className="flex flex-wrap items-center gap-1.5">
                {workNatureLabel(e.workNature)} <LawWarningBadges of={{ casualTooLong: e.casualTooLong }} />
              </span>
            ),
          },
        ]
      : []),
    { key: 'shift', label: 'Shift', value: e.shift && shiftLabel(e.shift), required: true },
    // 7 more days of annual leave (18 October 2026; Labour Law Art. 124), from an API that has it
    ...(e.hazardousWork !== undefined
      ? [{ key: 'hazardousWork', label: 'Hazardous work', value: e.hazardousWork ? 'Yes' : 'No', note: e.hazardousWork ? '7 more days of annual leave (Art. 124)' : undefined, hidden }]
      : []),
    // where they check in from (20 October 2026: check-ins locked to the office network, "Office staff, plus exceptions";
    // 24 October 2026: or to the check-in locations by GPS, "Yes, add a GPS lock too")
    ...(e.checkInAnywhere !== undefined
      ? [
          {
            key: 'checkInAnywhere',
            label: 'Checks in from',
            value: e.checkInAnywhere || e.workArrangement !== 'office' ? 'Anywhere' : 'The office network or the check-in locations, when check-ins are locked to them',
            hidden,
            note: e.checkInAnywhere ? 'Can check in from anywhere (HR’s exception)' : undefined,
          },
        ]
      : []),
    // whether their website presses need a location (20 October 2026: "Company switch + exceptions")
    ...(e.checkInWithoutLocation !== undefined
      ? [
          {
            key: 'checkInWithoutLocation',
            label: 'Checks in without a location',
            value: e.checkInWithoutLocation ? 'Yes' : 'No',
            note: e.checkInWithoutLocation
              ? 'Can check in without a location (HR’s exception)'
              : 'Needs it when Check-in Setup refuses check-ins without one, or locks Office staff to the check-in locations',
          },
        ]
      : []),
    {
      key: 'jdAcknowledgedAt',
      label: 'Job description acknowledged',
      value: e.jdAcknowledgedAt ? formatDate(e.jdAcknowledgedAt) : <span className="text-muted">Not yet</span>,
      note: e.jobTitle && !hidden && `Version ${e.jobTitle.jdVersion}`,
    },
  ];
}

/** An ending waiting for the CEO or approved: the employment is on its way out (and its contract isn't renewed). */
export const endingInProgress = (e: Employment) => e.ending?.status === 'pending_ceo' || e.ending?.status === 'approved';

/** What an employment was, for a confirmation: "the Full-time employment as Senior Designer, 01/03/2024 – now". */
function described(e: Employment): string {
  if (employmentHidden(e)) return 'the employment';
  return `the ${typeWord(e.employmentType)} employment${e.jobTitle ? ` as ${e.jobTitle.titleEn}` : ''}, ${periodLabel(e)}`;
}

/** A contract version as the history lists it: its number, then its version, term and status. */
function ContractLine({ contract: c, status = true }: { contract: Contract; status?: boolean }) {
  return (
    <>
      {/* its number, hidden from a developer (23 October 2026): Hidden */}
      <Shown text={c.number} />
      <span className="block text-xs text-muted tabular-nums">
        Version {c.version} · {termLabel(c)}
        {status && ` · ${CONTRACT_STATUS_LABELS[c.status]}`}
      </span>
    </>
  );
}

/**
 * An ended employment's contracts, every version newest first (the current employment's are in its Contract section).
 * Loaded on their own, so the history shows at once; nothing when they can't be seen or loaded.
 */
async function PastContracts({ employeeId, employment: e }: { employeeId: string; employment: Employment }) {
  let contracts: Contract[] | null;
  try {
    contracts = await loadContracts(employeeId, e.id);
  } catch (err) {
    if (err instanceof ApiError) return e.contract ? <ContractLine contract={e.contract} status={false} /> : dash;
    throw err;
  }
  if (!contracts?.length) return dash;
  return (
    <ul className="space-y-1.5">
      {contracts.map((c) => (
        <li key={c.id}>
          <ContractLine contract={c} />
        </li>
      ))}
    </ul>
  );
}

function History({ profile: p }: { profile: EmployeeProfile }) {
  const base = `/employees/${p.id}`;
  const actions = p.access.edit || p.access.delete;
  // the contracts of each employment, from an API that has contracts (October 2026)
  const contracts = p.employments.some((e) => e.contract !== undefined);
  if (p.employments.length === 0) {
    return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">No employments yet.</p>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Type</th>
            <th>Team</th>
            <th>Job Title</th>
            <th>Grade</th>
            {contracts && <th>Contracts</th>}
            <th>Status</th>
            <th>Note</th>
            {actions && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {p.employments.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap tabular-nums">
                <Shown text={periodLabel(e)} />
                {/* the profile's current one: a developer gets no end dates (22 October 2026: "Hide per-person details") */}
                {e.id === p.employment?.id && <span className="badge ml-2 align-middle">Current</span>}
              </td>
              <td className="whitespace-nowrap">
                <Shown text={labelOf(LABELS.employmentType, e.employmentType)} />
              </td>
              <td>{e.department ? <Shown text={departmentName(e.department)} /> : dash}</td>
              <td>{e.jobTitle ? <Shown text={e.jobTitle.titleEn} /> : dash}</td>
              <td className="whitespace-nowrap">{e.grade ? <Shown text={gradeLabel(e.grade)} /> : dash}</td>
              {contracts && (
                <td className="min-w-48 whitespace-nowrap">
                  {e.id !== p.employment?.id ? (
                    <Suspense fallback={<span className="text-xs text-muted">Loading…</span>}>
                      <PastContracts employeeId={p.id} employment={e} />
                    </Suspense>
                  ) : e.contract ? (
                    // the signed one; every version, with its pay, is in the Salary History
                    <ContractLine contract={e.contract} status={false} />
                  ) : (
                    <span className="text-muted">Not signed yet</span>
                  )}
                </td>
              )}
              <td>
                {e.id !== p.employment?.id ? (
                  <span className="badge bg-line-soft text-muted">{e.endReason ? END_REASON_LABELS[e.endReason] : LABELS.status[e.status]}</span>
                ) : (
                  <StatusBadge status={e.status} employmentType={e.employmentType} />
                )}
              </td>
              <td className="max-w-64 min-w-40 text-muted">{e.endNote ?? dash}</td>
              {actions && (
                <td>
                  <div className="flex items-center justify-end gap-4 whitespace-nowrap">
                    {p.access.edit && (
                      <Link href={`${base}/employment/${e.id}/edit`} className="inline-flex min-h-9 items-center text-sm font-semibold">
                        Edit<span className="sr-only"> {described(e)}</span>
                      </Link>
                    )}
                    {p.access.delete && (
                      <DeleteRowButton
                        action={deleteEmployment.bind(null, p.id, e.id)}
                        name={described(e)}
                        confirmText={`Delete ${described(e)}? Only for an employment added by mistake: it is taken out of ${p.fullNameEn}'s history. This cannot be undone.`}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The people whose current employment reports to this person (who can always open their profiles). */
function DirectReports({ profile: p }: { profile: EmployeeProfile }) {
  return (
    <ProfileSection title="Direct Reports" note={`${p.reports.length} ${p.reports.length === 1 ? 'person reports' : 'people report'} to ${p.fullNameEn}`}>
      <ul className="card px-6 py-2">
        {p.reports.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 last:border-0">
            <div className="min-w-0">
              <Link href={`/employees/${r.id}`} className="text-sm font-semibold">
                {r.fullNameEn}
              </Link>
              <p className="text-xs text-muted">{joinShown([r.employeeCode, r.jobTitle?.titleEn])}</p>
            </div>
            <StandingBadge standing={reportStanding(r)} />
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}

/** Details: the job, its contract, the history and the direct reports. */
async function DetailsSubTab({
  profile: p,
  user,
  linkPeople,
  justAdded,
  leaveYear,
}: {
  profile: EmployeeProfile;
  user: SessionUser;
  linkPeople: boolean;
  justAdded: boolean;
  /** The year of the leave shown (&leaveYear=); this year for none. */
  leaveYear: string;
}) {
  const e = p.employment;
  const base = `/employees/${p.id}`;
  // a developer gets no end dates (22 October 2026: "Hide per-person details"): then the newest, all of them ended
  const lastEnded = e ? null : (p.employments.find((x) => x.endDate) ?? (employmentHidden(p.employments[0]) ? p.employments[0] : undefined));
  // the top grade (the highest rank in the grades table, as the API counts it) has no manager to fill in
  const rank = e?.grade?.rank;
  const topGrade = rank !== undefined && (await apiGet<Grade[]>('/grades')).every((g) => g.rank <= rank);
  const isCeo = user.roles.includes('ceo');
  // HR or an Admin (a Super Admin counts as one) agree the last working day; never a developer, and the CEO only sees it
  const canSetLastDay = hasRole(user, 'hr', 'admin') && !user.developer;
  const today = todayInCairo();
  const ending = e && endingInProgress(e) ? e.ending : null;
  // how the last employment ended through the approvals, with its deadlines
  const lastEnding = lastEnded?.ending?.status === 'completed' ? lastEnded.ending : null;

  return (
    <div className="space-y-8">
      {justAdded && !e && p.employments.length === 0 && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          The profile of {p.fullNameEn} is saved, with the ID card in the employee file. Next, add the employment and its contract.
        </p>
      )}
      {e && <ProbationBanner employee={p} employment={e} today={today} endingInProgress={Boolean(ending)} />}
      {ending && <EndingPanel ending={ending} employeeName={p.fullNameEn} canEdit={p.access.edit} canSetLastDay={canSetLastDay} isCeo={isCeo} today={today} />}
      {e ? (
        <>
          <ProfileSection
            title="Current Employment"
            note={e.joinDate ? `Since ${formatDate(e.joinDate)}` : undefined}
            actions={
              p.access.edit && (
                <>
                  <Link href={`${base}/employment/${e.id}/edit`} className={`${small} btn-secondary`}>
                    Edit<span className="sr-only"> current employment</span>
                  </Link>
                  {/* an ending in progress is withdrawn (or completed) in its panel */}
                  {!ending && (
                    <Link href={`${base}/ending/new`} className={`${small} btn-danger`}>
                      End employment
                    </Link>
                  )}
                </>
              )
            }
          >
            <FieldGrid fields={employmentFields(e, linkPeople, topGrade)} />
            {/* their check-in locations (their home, 20 October 2026; remote sites and client locations they asked for, 24 October
                2026), with type, validity and status, for HR, the CEO and the Super Admin; loads on its own */}
            <Suspense fallback={null}>
              <HomeLocationLine employee={p} user={user} />
            </Suspense>
            {/* the sub-locations they are linked to (20 October 2026), for HR, Admin, the CEO and themself; loads on its own */}
            <Suspense fallback={null}>
              <CheckInPlacesLine employee={p} user={user} />
            </Suspense>
            <p className="text-sm text-muted">
              The social insurance forms are on the <Link href={profileHref(p.id, 'insurance')}>Social Insurance tab</Link>.
            </p>
          </ProfileSection>
          {/* exempt from check-in (owner, 25 October 2026: "Profile + a list in Check-in Setup"), by their attendance details,
              for HR, Admin, the CEO and themself; loads on its own */}
          <div id="exempt-from-check-in" className="scroll-mt-6 empty:hidden">
            <Suspense fallback={null}>
              <CheckInExemptionSection employee={p} user={user} />
            </Suspense>
          </div>
          {/* the employment's contract, right with it; where a missing contract detail links to (#contract) */}
          <div id="contract" className="scroll-mt-6">
            {/* loads on its own, so a slow contract list doesn't hold up the tab */}
            <Suspense fallback={<ContractSectionLoading />}>
              <ContractSection employee={p} employment={e} endingInProgress={Boolean(ending)} />
            </Suspense>
          </div>
        </>
      ) : (
        // #contract here too: with no current employment, hiring (the job and its contract) is where a contract starts
        <div id="contract" className="scroll-mt-6">
          <ProfileSection title="Current Employment">
            <div className="card space-y-4 px-6 py-8 text-center">
              <p className="text-sm text-muted">
                {lastEnded && !lastEnded.endDate
                  ? 'No current employment. The profile and the employment history are kept.'
                  : lastEnded?.endDate
                    ? `No current employment. ${p.fullNameEn} left on ${formatDate(lastEnded.endDate)}${lastEnded.endReason ? ` (${END_REASON_LABELS[lastEnded.endReason].toLowerCase()})` : ''}. The profile and the employment history are kept.`
                    : `${p.fullNameEn} is not employed yet. Add the employment once they are hired: the job and the terms of its contract, in one form.`}
              </p>
              {p.access.edit && (
                <Link href={`${base}/employment/new`} className="btn btn-primary">
                  {lastEnded ? 'Add a new employment' : 'Add employment'}
                </Link>
              )}
            </div>
          </ProfileSection>
        </div>
      )}
      {lastEnding && <EndingPanel ending={lastEnding} employeeName={p.fullNameEn} canEdit={p.access.edit} isCeo={isCeo} today={today} />}

      {/* the client accounts they are on (25 October 2026: the accounts allowance), loading on their own; nothing for those
          who may not see them */}
      <div id="client-accounts" className="scroll-mt-6 empty:hidden">
        <Suspense fallback={null}>
          <ClientAccountsSection employee={p} />
        </Suspense>
      </div>

      {/* the leave balance and requests (18 October 2026), loading on their own; nothing for those who may not see them */}
      <div id="leave" className="scroll-mt-6">
        <Suspense fallback={null}>
          <LeaveSection employee={p} user={user} year={leaveYear} />
        </Suspense>
      </div>

      <ProfileSection
        title="Employment History"
        note={p.employments.length > 0 && `${p.employments.length} ${p.employments.length === 1 ? 'employment' : 'employments'}, newest first`}
      >
        <History profile={p} />
      </ProfileSection>

      {p.reports.length > 0 && <DirectReports profile={p} />}
    </div>
  );
}

/**
 * Salary: the Salary History, the pay received and the loans and deductions for those who see salaries, and the Raise
 * Requests after the Salary History
 * (`raiseRequests`: already read for an employee or a manager, to offer them the sub-tab; `plans`: the employee's own
 * loans and deductions, read for them likewise). Each loads on its own.
 */
function SalarySubTab({
  profile: p,
  user,
  seesPay,
  raiseRequests,
  plans,
}: {
  profile: EmployeeProfile;
  user: SessionUser;
  seesPay: boolean;
  raiseRequests: EmployeeRaiseRequestsLoad | undefined;
  plans: Awaited<ReturnType<typeof loadDeductionPlans>> | undefined;
}) {
  return (
    <div className="space-y-8">
      {seesPay && (
        <div id="salary-history" className="scroll-mt-6">
          <Suspense fallback={<SalaryHistoryLoading />}>
            <SalaryHistorySection employee={p} />
          </Suspense>
        </div>
      )}
      {/* only for those who see raise requests (20 October 2026) */}
      {seesRaiseRequests(user) && (
        <div id="raise-requests" className="scroll-mt-6">
          {/* no placeholder: for many who open the tab there is nothing here (the API decides) */}
          <Suspense fallback={null}>
            <RaiseRequestsSection employee={p} user={user} loaded={raiseRequests} />
          </Suspense>
        </div>
      )}
      {seesPay && (
        // where a link to the employee's payslips points (#payslips)
        <div id="payslips" className="scroll-mt-6">
          <Suspense fallback={<PayReceivedLoading />}>
            <PayReceived employee={p} />
          </Suspense>
        </div>
      )}
      {(seesPay || plans?.kind === 'ok') && (
        // their advances and loans, with what is outstanding (owner, 17 October 2026), and their recurring deductions
        // (18 October 2026): the employee's own too
        <div id="advances" className="scroll-mt-6">
          <Suspense fallback={<AdvancesLoading />}>
            <AdvancesSection employee={p} staff={seesPay} loaded={plans} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/** Issued Documents: the documents generated from the templates (HR and the CEO). */
function IssuedDocumentsSubTab({ profile: p, user }: { profile: EmployeeProfile; user: SessionUser }) {
  return (
    // where the Social Insurance tab and the Salary History point for a contract version's documents, which come first
    // (#contract-documents); here, not inside the part that loads, so the page finds it to scroll to at once
    <div id="contract-documents" className="scroll-mt-6 space-y-8">
      <Suspense fallback={<GeneratedDocumentsLoading />}>
        <GeneratedDocuments employee={p} can={{ act: p.access.edit, delete: canDelete(user), templates: seesTemplates(user) }} />
      </Suspense>
    </div>
  );
}

export async function EmploymentTab({
  profile: p,
  linkPeople,
  sub = '',
  justAdded = false,
  leaveYear = '',
}: {
  profile: EmployeeProfile;
  linkPeople: boolean;
  /** The sub-tab the address asks for (&sub=); Details for none, or one the viewer doesn't see. */
  sub?: string;
  /** The year of the leave Details shows (&leaveYear=); this year for none. */
  leaveYear?: string;
  /** Just after Add employee saved the profile: say so, and what comes next. */
  justAdded?: boolean;
}) {
  const user = await getCurrentUser();
  const seesPay = canSeePayroll(user);
  // to the employee and their manager, Salary is only the raise requests and, on the employee's own profile, their loans
  // and deductions (18 October 2026): offered when there is something there for them; the raise requests not even read
  // for someone who doesn't see them (20 October 2026)
  const own = !!user.employeeId && user.employeeId === p.id;
  const [raiseRequests, plans] = seesPay
    ? [undefined, undefined]
    : await Promise.all([seesRaiseRequests(user) ? loadEmployeeRaiseRequests(p.id) : undefined, own ? loadDeductionPlans(p.id) : undefined]);
  const tabs = visibleSubTabs({
    pay: seesPay,
    raiseRequests: raiseRequests !== undefined && showsRaiseRequests(raiseRequests),
    deductionPlans: plans?.kind === 'ok' && hasPlans(plans.value),
    issuedDocuments: canSeeEmployeeFiles(user),
  });
  const visible = tabs.map((t) => t.key);
  const open = openSubTab(sub, visible);

  const content =
    open === 'salary' ? (
      <SalarySubTab profile={p} user={user} seesPay={seesPay} raiseRequests={raiseRequests} plans={plans} />
    ) : open === 'documents' ? (
      <IssuedDocumentsSubTab profile={p} user={user} />
    ) : (
      <DetailsSubTab profile={p} user={user} linkPeople={linkPeople} justAdded={justAdded} leaveYear={leaveYear} />
    );

  return (
    <>
      <AnchorSubTab visible={visible} />
      {/* Details alone needs no row of sub-tabs */}
      {tabs.length > 1 ? (
        <ProfileTabs
          tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: employmentHref(p.id, t.key) }))}
          active={open}
          label={`Employment of ${p.fullNameEn}`}
          size="small"
        >
          {content}
        </ProfileTabs>
      ) : (
        content
      )}
    </>
  );
}
