import Link from 'next/link';
import { Suspense } from 'react';
import { CONTRACT_STATUS_LABELS, END_REASON_LABELS, LABELS } from '@trendlix/shared';
import { ApiError, apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Contract, EmployeeProfile, Employment, Grade, SessionUser } from '@/lib/types';
import { canSeePayroll } from '../../payroll/list';
import { loadEmployeeRaiseRequests, type EmployeeRaiseRequestsLoad } from '../../raise-requests/data';
import { showsRaiseRequests } from '../../raise-requests/list';
import { deleteEmployment } from '../employment-actions';
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
  shiftLabel,
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
import { DeleteRowButton } from './inline-forms';
import { PayReceived, PayReceivedLoading } from './payslips/pay-received';
import { ProfileTabs } from './profile-tabs';
import { RaiseRequestsSection } from './raise-requests/raise-requests-section';
import { AdvancesLoading, AdvancesSection } from './advances/advances-section';
import { SalaryHistoryLoading, SalaryHistorySection } from './salary-history/salary-history-section';

// The Employment tab: everything about the job, in one place (owner, 16 October 2026: "there is no point of adding
// employment then adding contract and no active employment without a contract, its like a loop for me"; the Contracts
// tab was merged into it), in sub-tabs (owner, 17 October 2026: "move the salary history from the employment tab, it
// looks very busy now, or make subtabs"; the owner chose sub-tabs). The open one is in the address (&sub=, none for
// Details), so it survives a reload, and only it is rendered, each section loading on its own as before:
// - Details, for everyone who sees the profile: the probation banner and an ending in progress; the current employment
//   (Edit, End employment) with its contract (#contract: the signed version, a draft or a raise to sign, Renew, Raise,
//   the filing dates), or a way to hire, which takes the job and the contract's terms in one form; every employment in
//   the history, newest first, with its contracts; the people who report to this person now.
// - Salary: the Salary History (#salary-history: each employment's pay events, with what the Pay History table had)
//   and the pay received with the payslips (#payslips), HR's, Finance's and the CEO's, as the salary; between them the
//   Raise Requests (#raise-requests), where the employee asks for themself, their direct manager for them, or HR, and
//   each decision shows; then the advances and loans with what is outstanding (#advances: owner, 17 October 2026),
//   as the salary. The API sends each viewer only what they may see: the employee and their manager get only the
//   requests, so they are offered Salary only when there is something there for them.
// - Issued Documents, HR's and the CEO's: the documents generated from the templates (#contract-documents), which HR
//   generates and moves along and the CEO views and downloads; not the Documents tab, the papers the employee brings.
// Links from before the sub-tabs name only an anchor (?tab=employment#payslips): AnchorSubTab moves them to the sub-tab
// holding it. HR changes employments and contracts, confirms probation and records endings; the CEO approves or rejects
// endings here; only a Super Admin may delete an employment added by mistake (the API checks all of it again). The
// social insurance work is on its own tab.

const dash = <span className="text-muted">—</span>;
const small = 'btn min-h-9 px-3';

/** "Marketing › Content Team", or a department itself (e.g. for Head of Marketing, a title of the department's own). */
const placeLabel = (e: Employment) => (e.department && !e.department.parent ? 'Department' : 'Team');

/**
 * The current employment's details, in the profile's field grid. Its team, job title, grade, shift and manager count in
 * the profile's completeness (the manager except for the top grade, who reports to nobody), so they are Required.
 */
function employmentFields(e: Employment, linkPeople: boolean, topGrade: boolean): GridField[] {
  const grade = e.grade; // the person's own grade in this employment (within the job title's range, if it has one)
  return [
    { key: 'employmentType', label: 'Employment type', value: LABELS.employmentType[e.employmentType] },
    { key: 'status', label: 'Status', value: <StatusBadge status={e.status} /> },
    { key: 'team', label: placeLabel(e), value: e.department && departmentName(e.department), required: true },
    {
      key: 'jobTitle',
      label: 'Job title',
      value: e.jobTitle?.titleEn,
      required: true,
      note: e.jobTitle?.titleAr && (
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
      note: grade?.levelAr && (
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
    { key: 'joinDate', label: 'Join date', value: formatDate(e.joinDate) },
    { key: 'probationEnd', label: 'Probation end date', value: formatDate(e.probationEnd) },
    { key: 'workArrangement', label: 'Work arrangement', value: arrangementLabel(e) },
    { key: 'shift', label: 'Shift', value: e.shift && shiftLabel(e.shift), required: true },
    {
      key: 'jdAcknowledgedAt',
      label: 'Job description acknowledged',
      value: e.jdAcknowledgedAt ? formatDate(e.jdAcknowledgedAt) : <span className="text-muted">Not yet</span>,
      note: e.jobTitle && `Version ${e.jobTitle.jdVersion}`,
    },
  ];
}

/** An ending waiting for the CEO or approved: the employment is on its way out (and its contract isn't renewed). */
export const endingInProgress = (e: Employment) => e.ending?.status === 'pending_ceo' || e.ending?.status === 'approved';

/** What an employment was, for a confirmation: "the Full-time employment as Senior Designer, 01/03/2024 – now". */
function described(e: Employment): string {
  return `the ${LABELS.employmentType[e.employmentType].toLowerCase()} employment${e.jobTitle ? ` as ${e.jobTitle.titleEn}` : ''}, ${periodLabel(e)}`;
}

/** A contract version as the history lists it: its number, then its version, term and status. */
function ContractLine({ contract: c, status = true }: { contract: Contract; status?: boolean }) {
  return (
    <>
      {c.number}
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
                {periodLabel(e)}
                {!e.endDate && <span className="badge ml-2 align-middle">Current</span>}
              </td>
              <td className="whitespace-nowrap">{LABELS.employmentType[e.employmentType]}</td>
              <td>{e.department ? departmentName(e.department) : dash}</td>
              <td>{e.jobTitle?.titleEn ?? dash}</td>
              <td className="whitespace-nowrap">{e.grade ? gradeLabel(e.grade) : dash}</td>
              {contracts && (
                <td className="min-w-48 whitespace-nowrap">
                  {e.endDate ? (
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
                {e.endDate ? (
                  <span className="badge bg-line-soft text-muted">{e.endReason ? END_REASON_LABELS[e.endReason] : LABELS.status[e.status]}</span>
                ) : (
                  <StatusBadge status={e.status} />
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
              <p className="text-xs text-muted">
                {r.employeeCode}
                {r.jobTitle && ` · ${r.jobTitle.titleEn}`}
              </p>
            </div>
            <StatusBadge status={r.status} />
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
}: {
  profile: EmployeeProfile;
  user: SessionUser;
  linkPeople: boolean;
  justAdded: boolean;
}) {
  const e = p.employment;
  const base = `/employees/${p.id}`;
  const lastEnded = e ? null : p.employments.find((x) => x.endDate);
  // the top grade (the highest rank in the grades table, as the API counts it) has no manager to fill in
  const rank = e?.grade?.rank;
  const topGrade = rank !== undefined && (await apiGet<Grade[]>('/grades')).every((g) => g.rank <= rank);
  const isCeo = user.roles.includes('ceo');
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
      {ending && <EndingPanel ending={ending} employeeName={p.fullNameEn} canEdit={p.access.edit} isCeo={isCeo} today={today} />}
      {e ? (
        <>
          <ProfileSection
            title="Current Employment"
            note={`Since ${formatDate(e.joinDate)}`}
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
            <p className="text-sm text-muted">
              The social insurance forms are on the <Link href={profileHref(p.id, 'insurance')}>Social Insurance tab</Link>.
            </p>
          </ProfileSection>
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
                {lastEnded?.endDate
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
 * Salary: the Salary History, the pay received and the advances and loans for those who see salaries, and the Raise
 * Requests after the Salary History
 * (`raiseRequests`: already read for an employee or a manager, to offer them the sub-tab). Each loads on its own.
 */
function SalarySubTab({
  profile: p,
  user,
  seesPay,
  raiseRequests,
}: {
  profile: EmployeeProfile;
  user: SessionUser;
  seesPay: boolean;
  raiseRequests: EmployeeRaiseRequestsLoad | undefined;
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
      <div id="raise-requests" className="scroll-mt-6">
        {/* no placeholder: for many who open the tab there is nothing here (the API decides) */}
        <Suspense fallback={null}>
          <RaiseRequestsSection employee={p} user={user} loaded={raiseRequests} />
        </Suspense>
      </div>
      {seesPay && (
        // where a link to the employee's payslips points (#payslips)
        <div id="payslips" className="scroll-mt-6">
          <Suspense fallback={<PayReceivedLoading />}>
            <PayReceived employee={p} />
          </Suspense>
        </div>
      )}
      {seesPay && (
        // their advances and loans, with what is outstanding (owner, 17 October 2026)
        <div id="advances" className="scroll-mt-6">
          <Suspense fallback={<AdvancesLoading />}>
            <AdvancesSection employee={p} />
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
        <GeneratedDocuments employee={p} can={{ act: p.access.edit, delete: canDelete(user) }} />
      </Suspense>
    </div>
  );
}

export async function EmploymentTab({
  profile: p,
  linkPeople,
  sub = '',
  justAdded = false,
}: {
  profile: EmployeeProfile;
  linkPeople: boolean;
  /** The sub-tab the address asks for (&sub=); Details for none, or one the viewer doesn't see. */
  sub?: string;
  /** Just after Add employee saved the profile: say so, and what comes next. */
  justAdded?: boolean;
}) {
  const user = await getCurrentUser();
  const seesPay = canSeePayroll(user);
  // to the employee and their manager, Salary is only the raise requests: offered when there is something there for them
  const raiseRequests = seesPay ? undefined : await loadEmployeeRaiseRequests(p.id);
  const tabs = visibleSubTabs({
    pay: seesPay,
    raiseRequests: raiseRequests !== undefined && showsRaiseRequests(raiseRequests),
    issuedDocuments: canSeeEmployeeFiles(user),
  });
  const visible = tabs.map((t) => t.key);
  const open = openSubTab(sub, visible);

  const content =
    open === 'salary' ? (
      <SalarySubTab profile={p} user={user} seesPay={seesPay} raiseRequests={raiseRequests} />
    ) : open === 'documents' ? (
      <IssuedDocumentsSubTab profile={p} user={user} />
    ) : (
      <DetailsSubTab profile={p} user={user} linkPeople={linkPeople} justAdded={justAdded} />
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
