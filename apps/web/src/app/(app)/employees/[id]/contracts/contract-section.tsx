import Link from 'next/link';
import { CONTRACT_FORM_LABELS, CONTRACT_STATUS_LABELS, type ContractStatus } from '@trendlix/shared';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Contract, EmployeeProfile, Employment } from '@/lib/types';
import { deleteContract, signContract, updateSignedContract } from '../../contract-actions';
import { FieldGrid, Loading, ProfileSection, todayInCairo, type GridField } from '../../ui';
import { ActionButton, SignContract, SignedContractDetails } from './contract-buttons';
import { loadContracts } from './data';
import { daysBetween } from './dates';
import { formatEgp } from './salary';

// The Contract section of the Employment tab: the signed contract (its number, term, probation, signing and filing
// dates, and the salary for HR, Finance and the CEO), a draft waiting to be signed, and every version. HR drafts the
// first contract or a renewal, signs a draft or changes it, and sets a signed one's filing dates and note; only a Super
// Admin deletes a draft (owner's decision, 15 October 2026).

/** A fixed-term contract gets a warning this many days before it ends, if no renewal is drafted. */
const RENEWAL_WARNING_DAYS = 60;
/** …or this many days before its non-renewal notice is due (45 working days before the end: about 63 days). */
const NOTICE_WARNING_DAYS = 30;

const small = 'btn min-h-9 px-3';
const dash = <span className="text-muted">—</span>;
const notYet = <span className="text-muted">Not yet</span>;

const STATUS_STYLE: Record<ContractStatus, string> = {
  draft: 'bg-warn-soft text-warn',
  active: 'bg-ok-soft text-ok',
  ended: 'bg-line-soft text-muted',
  superseded: 'bg-line-soft text-muted',
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{CONTRACT_STATUS_LABELS[status]}</span>;
}

/** "01/11/2026 – 31/10/2027", or "From 01/11/2026" for an open-ended one. */
export function termLabel(c: Pick<Contract, 'startDate' | 'endDate'>): string {
  return c.endDate ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : `From ${formatDate(c.startDate)}`;
}

/** The signed contract, in the profile's field grid. The salary only when the caller may see it. */
function contractFields(c: Contract): GridField[] {
  const position = [c.jobTitleEn, c.gradeCode, c.departmentName, c.shiftCode && `Shift ${c.shiftCode}`].filter(Boolean).join(' · ');
  const fields: GridField[] = [
    { key: 'contract-number', label: 'Contract number', value: c.number, note: `Version ${c.version}` },
    {
      key: 'contract-form',
      label: 'Term',
      value: CONTRACT_FORM_LABELS[c.form],
      note: c.durationMonths && c.endDate ? `${c.durationMonths} months` : undefined,
    },
    { key: 'contract-period', label: 'Start – end', value: termLabel(c), note: !c.endDate && 'No end date' },
    {
      key: 'contract-probation',
      label: 'Probation end date',
      value: c.probationEnd ? formatDate(c.probationEnd) : <span className="text-muted">No probation</span>,
    },
    { key: 'contract-signed', label: 'Signed on', value: formatDate(c.signedOn) },
    { key: 'contract-insurance', label: 'Filed with social insurance', value: c.insuranceFiledOn ? formatDate(c.insuranceFiledOn) : notYet },
    { key: 'contract-labour-office', label: 'Filed with the labour office', value: c.labourOfficeFiledOn ? formatDate(c.labourOfficeFiledOn) : notYet },
    {
      key: 'contract-position',
      label: 'Position as signed',
      value: position,
      note: c.jobTitleAr && (
        <span lang="ar" dir="rtl">
          {c.jobTitleAr}
        </span>
      ),
    },
  ];
  if (!c.salaryHidden && c.grossSalary !== null) {
    fields.push(
      { key: 'contract-gross', label: 'Gross salary', value: formatEgp(c.grossSalary), protected: true },
      {
        key: 'contract-split',
        label: 'Basic / variable',
        value: c.basicSalary !== null && c.variableSalary !== null && `${formatEgp(c.basicSalary)} / ${formatEgp(c.variableSalary)}`,
        protected: true,
        note: c.basicPercent !== null && `${c.basicPercent}% basic; the variable part follows the monthly performance reports`,
      },
      { key: 'contract-net', label: 'Approximate net salary', value: c.netSalary !== null && formatEgp(c.netSalary), protected: true },
      {
        key: 'contract-insured',
        label: 'Insured salary',
        value: c.insuredSalary !== null && formatEgp(c.insuredSalary),
        protected: true,
        note: 'On the social insurance copy: the gross, capped at the maximum insurable wage',
      },
    );
  }
  if (c.note) fields.push({ key: 'contract-note', label: 'Note', value: c.note });
  return fields;
}

/**
 * Renew in writing before a fixed-term contract ends: warned 60 days before the end, or 30 days before the
 * non-renewal notice is due, whichever comes first. After the end, without a written renewal, it counts as open-ended.
 */
function RenewalWarning({ contract: c, today }: { contract: Contract; today: string }) {
  if (c.form !== 'fixed' || !c.endDate) return null;
  const toEnd = daysBetween(today, c.endDate);
  const noticeBy = c.nonRenewalNoticeBy;
  const toNotice = noticeBy ? daysBetween(today, noticeBy) : null;
  if (toEnd > RENEWAL_WARNING_DAYS && (toNotice === null || toNotice > NOTICE_WARNING_DAYS)) return null;
  if (toEnd < 0) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
        The contract ended on {formatDate(c.endDate)} without a written renewal. If work continued, it now counts as open-ended (Labour Law Art. 88). Renew it
        in writing.
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      The contract ends on {formatDate(c.endDate)}. Renew it in writing before then
      {noticeBy && toNotice !== null && toNotice >= 0
        ? `, or give the non-renewal notice by ${formatDate(noticeBy)}.`
        : noticeBy
          ? `. The non-renewal notice was due by ${formatDate(noticeBy)}.`
          : '.'}
    </p>
  );
}

/** A draft waiting to be signed: what it says, for HR Sign and Edit, and for a Super Admin Delete. */
function DraftCard({
  draft: d,
  employeeId,
  canEdit,
  canDelete,
  today,
}: {
  draft: Contract;
  employeeId: string;
  canEdit: boolean;
  canDelete: boolean;
  today: string;
}) {
  const name = `version ${d.version} (${d.number})`;
  const what = [
    CONTRACT_FORM_LABELS[d.form],
    termLabel(d),
    d.probationMonths > 0 ? `${d.probationMonths} months' probation` : 'no probation',
    !d.salaryHidden && d.grossSalary !== null && `gross ${formatEgp(d.grossSalary)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="card space-y-3 border-dashed p-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          Draft: Version {d.version}
          {d.version > 1 && ' (Renewal)'}
        </h3>
        <ContractStatusBadge status="draft" />
        <span className="text-xs text-muted">{d.number}</span>
      </div>
      <p className="text-sm">{what}</p>
      {d.note && <p className="text-sm text-muted">{d.note}</p>}
      {!canEdit && <p className="text-xs text-muted">Waiting to be signed.</p>}
      {(canEdit || canDelete) && (
        <div className="flex flex-wrap items-start gap-3">
          {canEdit && (
            <>
              <SignContract action={signContract.bind(null, d.id)} today={today} name={name} />
              <Link href={`/employees/${employeeId}/contracts/${d.id}/edit`} className={`${small} btn-secondary`}>
                Edit<span className="sr-only"> the draft of {name}</span>
              </Link>
            </>
          )}
          {canDelete && (
            <ActionButton
              action={deleteContract.bind(null, d.id)}
              pendingText="Deleting…"
              variant="danger"
              confirmText={`Delete the draft of ${name}? This cannot be undone.`}
            >
              Delete<span className="sr-only"> the draft of {name}</span>
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}

/** Every version, newest first. */
function Versions({ contracts }: { contracts: Contract[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Contract versions, newest first</caption>
        <thead>
          <tr>
            <th>Version</th>
            <th>Number</th>
            <th>Term</th>
            <th>Start – End</th>
            <th>Probation</th>
            <th>Signed On</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id}>
              <td className="tabular-nums">{c.version}</td>
              <td className="whitespace-nowrap">{c.number}</td>
              <td className="whitespace-nowrap">{CONTRACT_FORM_LABELS[c.form]}</td>
              <td className="whitespace-nowrap tabular-nums">{termLabel(c)}</td>
              <td className="whitespace-nowrap tabular-nums">{c.probationEnd ? `To ${formatDate(c.probationEnd)}` : dash}</td>
              <td className="whitespace-nowrap tabular-nums">{c.signedOn ? formatDate(c.signedOn) : dash}</td>
              <td>
                <ContractStatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <ProfileSection title="Contract">{children}</ProfileSection>;
}

export function ContractSectionLoading() {
  return (
    <Title>
      <Loading />
    </Title>
  );
}

/**
 * The current employment's contract. `canEdit`: HR. `endingInProgress`: an ending is waiting for the CEO or approved,
 * so no renewal is offered or asked for.
 */
export async function ContractSection({
  employee,
  employment: e,
  endingInProgress,
}: {
  employee: Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'access'>;
  employment: Employment;
  endingInProgress: boolean;
}) {
  let contracts: Contract[] | null;
  try {
    contracts = await loadContracts(employee.id, e.id);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 403) return null; // not the caller's to see
    // the rest of the profile stays usable
    return (
      <Title>
        <p className="card p-6 text-sm text-muted">The contract could not be loaded. Please try again in a moment.</p>
      </Title>
    );
  }
  if (!contracts) {
    return (
      <Title>
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">Not available yet.</p>
      </Title>
    );
  }

  const today = todayInCairo();
  const canEdit = employee.access.edit;
  const active = contracts.find((c) => c.status === 'active');
  const draft = contracts.find((c) => c.status === 'draft');
  const previous = contracts.find((c) => c.status !== 'draft');
  // HR drafts the first contract, or renews a fixed-term one (one draft at a time)
  const offer = canEdit && !draft && !endingInProgress && (!previous ? 'New contract' : previous.endDate ? 'Renew' : null);

  return (
    <ProfileSection
      title="Contract"
      note={active ? `Version ${active.version}${active.signedOn ? `, signed ${formatDate(active.signedOn)}` : ''}` : undefined}
      actions={
        offer && (
          <Link href={`/employees/${employee.id}/contracts/new`} className={`${small} ${offer === 'Renew' ? 'btn-secondary' : 'btn-primary'}`}>
            {offer}
            {offer === 'Renew' && <span className="sr-only"> the contract</span>}
          </Link>
        )
      }
    >
      {active && !draft && !endingInProgress && <RenewalWarning contract={active} today={today} />}
      {active ? (
        <div className="space-y-3">
          <FieldGrid fields={contractFields(active)} />
          {active.salaryHidden && <p className="text-xs text-muted">The salary is shown to HR, Finance and the CEO only.</p>}
          {canEdit && <SignedContractDetails action={updateSignedContract.bind(null, active.id)} contract={active} />}
        </div>
      ) : previous ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
          No contract in force: version {previous.version} ({previous.number}) is {CONTRACT_STATUS_LABELS[previous.status].toLowerCase()}
          {previous.endDate && `, with its end on ${formatDate(previous.endDate)}`}.
        </p>
      ) : (
        !draft && (
          <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
            No signed contract yet.{canEdit && ' Draft the first one with New contract, and sign it once the employee and the company have signed it.'}
          </p>
        )
      )}
      {draft && <DraftCard draft={draft} employeeId={employee.id} canEdit={canEdit} canDelete={employee.access.delete} today={today} />}
      {contracts.length > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-semibold">Versions</h3>
          <Versions contracts={contracts} />
        </div>
      )}
    </ProfileSection>
  );
}
