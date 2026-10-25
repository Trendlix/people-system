import Link from 'next/link';
import { agreementName, CONTRACT_STATUS_LABELS, INTERN_NO_WAGE_TEXT, PAY_BASIS_LABELS, type ContractStatus } from '@trendlix/shared';
import { treatmentText } from '@/lib/allowances';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { AllowanceLine, Contract, EmployeeProfile, Employment } from '@/lib/types';
import { canSeePayroll } from '../../../payroll/list';
import { deleteContract, signContract, unsignContract, updateSignedContract } from '../../contract-actions';
import { contractLengthText, OPEN_ENDED_NOTE, SPECIFIC_JOB_NOTE } from '../../employment-law';
import { LawWarningBadges, LawWarningNotes } from '../../law-badges';
import { FieldGrid, Loading, ProfileSection, salaryHistoryHref, todayInCairo, type GridField } from '../../ui';
import { ActionButton, SignContract, SignedContractDetails } from './contract-buttons';
import { loadContracts } from './data';
import { daysBetween, termLabel } from './dates';
import { RaiseCard } from './raise-card';
import { allowancesLabel, daysLabel, formatEgp, hourlyNetTerms, hourlyTerms, payLabel } from './salary';
import { stageLabel, trainingSummary } from './trainee-stages';
import { CONVERSION_SIGN_HINT, contractActions, convertHref, draftKind, trainingReminder } from './training';
import { shownCode, withCodeInBrackets } from '@/lib/hidden';
import { Hidden } from '@/components/hidden';

// The Contract section of the Employment tab's Details, right below the current employment (the Contracts tab was
// merged into Employment, owner's request, 16 October 2026): the signed contract (its number, term, probation, signing
// and filing dates, its pay basis and working days, and the salary and allowances for HR, Finance and the CEO) and a
// draft waiting to be signed. HR drafts the first contract or a renewal, signs a draft or changes it, and sets a
// signed one's filing dates and note; only a Super Admin deletes a draft, or undoes a signing recorded by mistake
// (owner's decision, 15 October 2026).
//
// Its length by the labour law (owner, 18 October 2026: "can we update the employment types based on the labour law?";
// on 15 October every contract was fixed-term): fixed-term (renewed in writing; past its end without a signed renewal
// the law counts it as open-ended, Art. 88(3), warned here), open-ended (no end date and no renewal, Art. 156) or for a
// specific job (Art. 155); a trainee's is the training agreement, with its stages and the pay of each (Art. 29).
//
// Trainees' and interns' agreements (owner, 19 October 2026: "interns to be labeled trainees instead of probation and
// their contracts are never renewed", then "or can be only renewed 1 time, after that it should be converted to a full
// time contract"): Renew only while the first agreement is in force, Convert to full-time always (a full-time contract as
// the employment's next version, which signing makes the employment full-time); near and past its end, the agreement's
// way forward instead of the renewal warning (never "renew in writing", the non-renewal notice or Art. 88); no Raise; and
// an intern's (the unpaid internship) shows No wage for its gross.
//
// Pay raises during a contract (owner's decisions, 16 October 2026): HR raises the pay of the signed contract in force
// (Raise, beside Renew), as an amendment or a new contract; a raise, or a renewal with new pay, waits in its own card for
// the CEO's approval before it is signed ("HR, then the CEO"). Every version, with the change of pay, its stage, the CEO's
// decision and from when the insured wage follows it, is on the Salary sub-tab's Salary History (its Pay History table
// was merged into that timeline, owner's choice, 17 October 2026), for HR, Finance and the CEO.

/** A fixed-term contract gets a warning this many days before it ends, if no renewal is drafted. */
const RENEWAL_WARNING_DAYS = 60;
/** …or this many days before its non-renewal notice is due (45 working days before the end: about 63 days). */
const NOTICE_WARNING_DAYS = 30;

const small = 'btn min-h-9 px-3';
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

// in dates.ts, where the raise card uses it too; still exported from here
export { termLabel };

/** Each allowance with its amount a month and how it is treated. */
function AllowanceList({ lines }: { lines: AllowanceLine[] }) {
  return (
    <ul className="space-y-0.5">
      {lines.map((a) => (
        <li key={a.allowanceTypeId}>
          {a.nameEn} <span className="tabular-nums">{formatEgp(a.amount)}</span>
          <span className="block text-xs text-muted">{treatmentText(a)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Under a trainee's or an intern's agreement's length: which one it is, and what follows it (19 October 2026). */
function agreementNote(c: Contract): string | undefined {
  if (!c.training) return undefined;
  return c.training.next === 'convert_or_end' ? 'Renewed once: next, converted to full-time or ended' : 'Renewed once at most, then converted to full-time';
}

/**
 * The signed contract, in the profile's field grid. The salary only when the caller may see it. `unpaid`: an intern's
 * internship agreement, which pays no wage (19 October 2026).
 */
function contractFields(c: Contract, unpaid: boolean): GridField[] {
  const hourly = c.payBasis === 'hourly';
  // a trainee's training agreement (18 October 2026)
  const stages = c.traineeStages?.length ? c.traineeStages : null;
  const position = [c.jobTitleEn, c.gradeCode, c.departmentName, c.shiftCode && `Shift ${c.shiftCode}`].filter(Boolean).join(' · ');
  // a developer gets none of the contract's dates and terms (owner, 22 October 2026: "Hide per-person details", "and the
  // social insurance"): a signed contract always has a start, so none says it was hidden; each shows Hidden
  const hidden = !c.startDate;
  const fields: GridField[] = [
    // its number hidden from a developer (owner, 23 October 2026: "in developer view use **** instead of IDs")
    { key: 'contract-number', label: 'Contract number', value: shownCode(c.number) ?? <Hidden />, note: `Version ${c.version}` },
    stages
      ? { key: 'contract-form', label: 'Contract length', value: 'Training agreement', note: [trainingSummary(stages), agreementNote(c)].filter(Boolean).join('. ') }
      : unpaid
        ? { key: 'contract-form', label: 'Contract length', value: 'Internship agreement', note: [contractLengthText(c), agreementNote(c)].filter(Boolean).join('. ') }
        : {
            key: 'contract-form',
            label: 'Contract length',
            value: contractLengthText(c),
            note: c.form === 'open_ended' ? OPEN_ENDED_NOTE : c.form === 'specific_job' ? SPECIFIC_JOB_NOTE : agreementNote(c),
          },
    {
      key: 'contract-period',
      label: 'Start – end',
      value: termLabel(c),
      note: c.form === 'specific_job' && c.endDate ? 'The end: when the job is expected to be done' : undefined,
    },
    ...(stages
      ? [
          {
            key: 'contract-stages',
            label: 'Training stages',
            value: (
              <ol className="list-decimal space-y-0.5 pl-4">
                {stages.map((s, i) => (
                  <li key={i}>{stageLabel(s)}</li>
                ))}
              </ol>
            ),
            protected: !c.salaryHidden,
            note: c.traineeStage
              ? `Now stage ${c.traineeStage.number}, ${c.traineeStage.name}. The pay rises from stage to stage (Labour Law Art. 29); payroll pays each stage’s in its months`
              : 'The pay rises from stage to stage (Labour Law Art. 29); payroll pays each stage’s in its months',
          },
        ]
      : []),
    {
      key: 'contract-probation',
      label: 'Probation end date',
      value: c.probationEnd ? formatDate(c.probationEnd) : <span className="text-muted">No probation</span>,
      hidden,
    },
    { key: 'contract-signed', label: 'Signed on', value: formatDate(c.signedOn), hidden },
    { key: 'contract-insurance', label: 'Filed with social insurance', value: c.insuranceFiledOn ? formatDate(c.insuranceFiledOn) : notYet, hidden },
    { key: 'contract-labour-office', label: 'Filed with the labour office', value: c.labourOfficeFiledOn ? formatDate(c.labourOfficeFiledOn) : notYet, hidden },
    {
      key: 'contract-position',
      label: 'Position as signed',
      value: position,
      hidden,
      note: c.jobTitleAr && (
        <span lang="ar" dir="rtl">
          {c.jobTitleAr}
        </span>
      ),
    },
    {
      key: 'contract-pay-basis',
      label: 'Pay basis',
      value: PAY_BASIS_LABELS[c.payBasis] ?? PAY_BASIS_LABELS.monthly,
      hidden,
      // by the hour: the rate (for those who see the salary) and the hours a week, then the net per hour it comes to
      note: [hourlyTerms(c), hourlyNetTerms(c)].filter(Boolean).join(' · ') || null,
      protected: hourly && !c.salaryHidden,
    },
    { key: 'contract-days', label: 'Working days', value: daysLabel(c.daysPerWeek ?? null) ?? "The shift's week" },
  ];
  if (!c.salaryHidden && c.grossSalary !== null && unpaid) {
    // the unpaid internship: no wage, the allowances alone (no basic part, net or insured salary to show)
    const allowances = c.allowances ?? [];
    fields.push(
      { key: 'contract-gross', label: 'Gross salary', value: INTERN_NO_WAGE_TEXT, protected: true, note: 'The allowances are what the intern is paid' },
      {
        key: 'contract-allowances',
        label: 'Allowances',
        value: allowances.length > 0 ? <AllowanceList lines={allowances} /> : <span className="text-muted">None</span>,
        protected: true,
        note: allowances.length > 0 && c.allowancesTotal !== null && `${formatEgp(c.allowancesTotal)} a month in total`,
      },
    );
  } else if (!c.salaryHidden && c.grossSalary !== null) {
    const allowances = c.allowances ?? [];
    fields.push(
      {
        key: 'contract-gross',
        label: 'Gross salary',
        value: formatEgp(c.grossSalary),
        protected: true,
        note: hourly ? 'The monthly estimate: the hourly rate × the hours a week × 52 ÷ 12' : allowances.length > 0 ? 'Without the allowances' : undefined,
      },
      {
        key: 'contract-allowances',
        label: 'Allowances',
        value: allowances.length > 0 ? <AllowanceList lines={allowances} /> : <span className="text-muted">None</span>,
        protected: true,
        note: allowances.length > 0 && c.allowancesTotal !== null && `${formatEgp(c.allowancesTotal)} a month in total, on top of the gross`,
      },
      ...(allowances.length > 0
        ? [{ key: 'contract-total', label: 'Gross and allowances', value: c.totalSalary !== null && formatEgp(c.totalSalary), protected: true, note: 'A month' }]
        : []),
      {
        key: 'contract-split',
        label: 'Basic / variable',
        value: c.basicSalary !== null && c.variableSalary !== null && `${formatEgp(c.basicSalary)} / ${formatEgp(c.variableSalary)}`,
        protected: true,
        note: c.basicPercent !== null && `${c.basicPercent}% basic; the variable part follows the monthly performance reports`,
      },
      {
        key: 'contract-net',
        label: 'Net salary',
        value: c.netSalary !== null && formatEgp(c.netSalary),
        protected: true,
        note: allowances.length > 0 ? 'Allowances included' : undefined,
      },
      {
        key: 'contract-insured',
        label: 'Insured salary',
        value: c.insuredSalary !== null && formatEgp(c.insuredSalary),
        protected: true,
        note: 'On the social insurance copy: the gross and the insured allowances, capped at the maximum insurable wage',
      },
    );
  }
  if (c.note) fields.push({ key: 'contract-note', label: 'Note', value: c.note });
  return fields;
}

/**
 * Renew in writing before a fixed-term contract ends: warned 60 days before the end, or 30 days before the
 * non-renewal notice is due, whichever comes first. After the end, without a written renewal, the law counts it as
 * open-ended (Labour Law Art. 88): from an API that works it out (becameOpenEnded), its warning says so instead. Not for
 * an open-ended contract, nor one for a specific job (carried on after the job, it counts as renewed: Art. 155).
 */
function RenewalWarning({ contract: c, today }: { contract: Contract; today: string }) {
  // a trainee's or an intern's agreement isn't renewed in writing nor given a non-renewal notice: TrainingReminder
  if (!c.endDate || c.form !== 'fixed' || c.becameOpenEnded || c.training) return null;
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

/**
 * A trainee's or an intern's agreement near or past its end (19 October 2026): "Training ends on 31/03/2027: renew it
 * once, or convert to full-time.", with where each is done; from 60 days before the end.
 */
function TrainingReminder({ contract: c, today }: { contract: Contract; today: string }) {
  const reminder = trainingReminder(c, today);
  if (!reminder) return null;
  return (
    <p role="alert" className={`rounded-lg px-4 py-3 text-sm ${reminder.passed ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>
      {reminder.text} {reminder.way}
    </p>
  );
}

/**
 * A draft waiting to be signed: what it says, for HR Sign and Edit, and for a Super Admin Delete. `unpaid`: an intern's
 * agreement (not a conversion to full-time, which has its gross).
 */
function DraftCard({
  draft: d,
  employeeId,
  canEdit,
  canDelete,
  today,
  unpaid,
}: {
  draft: Contract;
  employeeId: string;
  canEdit: boolean;
  canDelete: boolean;
  today: string;
  unpaid: boolean;
}) {
  const name = withCodeInBrackets(`version ${d.version}`, d.number);
  const allowances = d.allowances ?? [];
  const what = [
    d.traineeStages?.length ? `Training agreement, ${trainingSummary(d.traineeStages)}` : contractLengthText(d),
    termLabel(d),
    d.probationMonths > 0 ? `${d.probationMonths} months' probation` : 'no probation',
    unpaid ? 'no wage (unpaid internship)' : payLabel(d),
    hourlyNetTerms(d),
    !unpaid && !d.salaryHidden && d.grossSalary !== null && `gross ${formatEgp(d.grossSalary)}`,
    !d.salaryHidden && allowances.length > 0 && `allowances ${allowancesLabel(allowances)}`,
    !d.salaryHidden && allowances.length > 0 && d.totalSalary !== null && `${formatEgp(d.totalSalary)} a month in all`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="card space-y-3 border-dashed p-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          Draft: Version {d.version}
          {draftKind(d)}
        </h3>
        <ContractStatusBadge status="draft" />
        {shownCode(d.number) && <span className="text-xs text-muted">{d.number}</span>}
      </div>
      <p className="text-sm">{what}</p>
      {d.note && <p className="text-sm text-muted">{d.note}</p>}
      {!canEdit && <p className="text-xs text-muted">Waiting to be signed.</p>}
      {(canEdit || canDelete) && (
        <div className="flex flex-wrap items-start gap-3">
          {canEdit && (
            <>
              <SignContract
                action={signContract.bind(null, d.id)}
                today={today}
                name={name}
                hint={d.convertsTo ? CONVERSION_SIGN_HINT : undefined}
              />
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

/**
 * Undo signing, for a Super Admin: a contract marked signed by mistake becomes a draft again, to correct and sign
 * again, or delete. Not while the next version is drafted or an ending is open; the API also refuses it once a signed
 * copy of its documents is uploaded.
 */
function UndoSigning({ contract: c, draft, endingInProgress }: { contract: Contract; draft: Contract | undefined; endingInProgress: boolean }) {
  const name = withCodeInBrackets(`version ${c.version}`, c.number);
  const blocked = draft
    ? `Version ${draft.version} is drafted after it: delete that draft first.`
    : endingInProgress
      ? 'An ending of this employment is in progress.'
      : undefined;
  const after =
    c.version > 1
      ? `it becomes a draft again and version ${c.version - 1} is the contract again`
      : 'it becomes a draft again and the probation is as before the signing';
  return (
    <ActionButton
      action={unsignContract.bind(null, c.id)}
      pendingText="Undoing…"
      variant="danger"
      disabled={!!blocked}
      disabledNote={blocked}
      confirmText={`Undo the signing of ${name}? Only for a contract marked signed by mistake: ${after}.`}
    >
      Undo signing<span className="sr-only"> of {name}</span>
    </ActionButton>
  );
}

/**
 * An employment with no contract at all, from before hiring took the contract's terms in the same form (owner, 16
 * October 2026: "no active employment without a contract"): HR is asked to add it here.
 */
function NoContract({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  return (
    <div role={canEdit ? 'alert' : undefined} className="space-y-3 rounded-lg bg-warn-soft px-4 py-4 text-sm text-warn">
      <p>
        This employment has no contract yet.
        {canEdit && ' Add it now: its terms are saved as a draft to print, and signed here once the employee and the company have signed it.'}
      </p>
      {canEdit && (
        <Link href={`/employees/${employeeId}/contracts/new`} className={`${small} btn-primary`}>
          Add the contract
        </Link>
      )}
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
  const user = await getCurrentUser();
  const canEdit = employee.access.edit;
  const active = contracts.find((c) => c.status === 'active');
  const draft = contracts.find((c) => c.status === 'draft');
  const previous = contracts.find((c) => c.status !== 'draft');
  // HR renews the last one (one draft at a time), unless it is open-ended (never renewed, Art. 156) or a trainee's or an
  // intern's agreement renewed once already (19 October 2026), which is converted to full-time instead; an employment
  // with no contract at all is asked for one below. HR raises the pay of the signed contract in force, one change at a
  // time (owner's decisions, 16 October 2026); not a trainee's, paid by the training agreement's stages (18 October
  // 2026), nor an intern's, unpaid (training.ts)
  const can = contractActions({ canEdit, hasDraft: !!draft, endingInProgress, previous, active: !!active, employmentType: e.employmentType });
  const offer = can.renew && 'Renew';
  const raise = can.raise;
  // an intern's agreement pays no wage; a conversion to full-time has its gross
  const unpaid = e.employmentType === 'intern';

  return (
    <ProfileSection
      title="Contract"
      note={
        active ? (
          <>
            Version {active.version}
            {active.signedOn && `, signed ${formatDate(active.signedOn)}`} <LawWarningBadges of={{ becameOpenEnded: active.becameOpenEnded }} />
          </>
        ) : undefined
      }
      actions={
        (raise || offer || can.convert) && (
          <>
            {can.convert && (
              <Link href={convertHref(employee.id)} className={`${small} btn-secondary`}>
                Convert<span className="sr-only"> the {agreementName(e.employmentType)}</span> to full-time
              </Link>
            )}
            {raise && (
              <Link href={`/employees/${employee.id}/contracts/raise`} className={`${small} btn-secondary`}>
                Raise<span className="sr-only"> the pay</span>
              </Link>
            )}
            {offer && (
              <Link href={`/employees/${employee.id}/contracts/new`} className={`${small} ${offer === 'Renew' ? 'btn-secondary' : 'btn-primary'}`}>
                {offer}
                {offer === 'Renew' && <span className="sr-only"> the contract</span>}
              </Link>
            )}
          </>
        )
      }
    >
      {active && !draft && !endingInProgress && <RenewalWarning contract={active} today={today} />}
      {/* a trainee's or an intern's agreement: renewed once, converted to full-time or ended (19 October 2026) */}
      {active && !draft && !endingInProgress && <TrainingReminder contract={active} today={today} />}
      {/* by the labour law (18 October 2026): a fixed term that became open-ended (Art. 88); casual work past its 6 months
          is the employment's, warned with it */}
      {active && <LawWarningNotes of={{ becameOpenEnded: active.becameOpenEnded }} />}
      {active ? (
        <div className="space-y-3">
          <FieldGrid fields={contractFields(active, unpaid)} />
          {active.salaryHidden && <p className="text-xs text-muted">The salary is shown to HR, Finance and the CEO only.</p>}
          {canEdit && <SignedContractDetails action={updateSignedContract.bind(null, active.id)} contract={active} />}
          {employee.access.delete && <UndoSigning contract={active} draft={draft} endingInProgress={endingInProgress} />}
        </div>
      ) : previous ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
          No contract in force: {withCodeInBrackets(`version ${previous.version}`, previous.number)} is {CONTRACT_STATUS_LABELS[previous.status].toLowerCase()}
          {previous.endDate && `, with its end on ${formatDate(previous.endDate)}`}.
        </p>
      ) : (
        !draft && <NoContract employeeId={employee.id} canEdit={canEdit && !endingInProgress} />
      )}
      {/* a renewal or a conversion drafted for someone still marked studying past their expected graduation (25 October
          2026): the qualification it prints may be out of date; never blocking */}
      {draft?.studentWarning && (
        <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {draft.studentWarning} <Link href={`/employees/${employee.id}?tab=education#field-qualificationAr`}>See the qualification</Link>
        </p>
      )}
      {draft &&
        (draft.raise ? (
          // a change of pay: the CEO approves it before it is signed
          <RaiseCard
            draft={draft}
            contracts={contracts}
            employeeId={employee.id}
            canEdit={canEdit}
            canDelete={employee.access.delete}
            isCeo={hasRole(user, 'ceo')}
            today={today}
          />
        ) : (
          <DraftCard
            draft={draft}
            employeeId={employee.id}
            canEdit={canEdit}
            canDelete={employee.access.delete}
            today={today}
            unpaid={unpaid && !draft.convertsTo}
          />
        ))}
      {contracts.length > 0 && canSeePayroll(user) && (
        // every version and its pay are in the Salary History (the Pay History table was merged into it)
        <p className="text-sm text-muted">
          Every version, with its pay, the CEO&apos;s decision and Form 2: <Link href={salaryHistoryHref(employee.id)}>Salary History</Link>.
        </p>
      )}
    </ProfileSection>
  );
}
