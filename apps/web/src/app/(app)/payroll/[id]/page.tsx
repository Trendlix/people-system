import Link from 'next/link';
import { Suspense } from 'react';
import { EMPTY_PAYROLL_INPUTS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import type { PayrollLineView, PayrollRunView, SessionUser } from '@/lib/types';
import { ActionButton } from '../../employees/[id]/contracts/contract-buttons';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { contractHref, profileHref, todayInCairo } from '../../employees/ui';
import { loadPayrollSettings } from '../../organization/payroll/data';
import { paidOnDefault } from '../../organization/payroll/settings';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { adjustmentsHref } from '../adjustments/adjustments';
import { approveRun, deleteRun, markRunPaid, refreshFromAttendance, refreshRun, returnRun, saveRunLines, setAttendanceWaiver, submitRun } from '../actions';
import { loadRun } from '../data';
import { bankFilesReady, bankLeftOut, fileHref } from '../files';
import { canSeePayroll, employeesLabel, preparesPayroll, rulesSummary, runActions, runTitle } from '../list';
import { payslipsIssued, payslipsIssuedLabel, payslipsZipHref } from '../payslips';
import { PayrollStatusBadge, PayrollStepper } from '../ui';
import { anyEditable, employeesNote, figuresNote, filesNote, hiddenCount, hiddenRowLabel, hiddenTotalsNote, lineEditable } from './access';
import { RunAdjustments } from './adjustments-section';
import { attendanceUploadHref, REFRESH_FROM_ATTENDANCE_HINT, refreshesFromAttendance } from './attendance/attendance';
import { loadImports } from './attendance/data';
import { ImportsList } from './attendance/imports-list';
import { CibFileForm } from './downloads';
import { contractsNote, lineItems } from './grid';
import { InputsGrid, type GridRow } from './inputs-grid';
import { ResultsTable } from './results-table';
import { MarkPaid, ReturnRun } from './run-actions';

// One month's payroll run (owner's decisions, 16 October 2026): where it stands (Draft → With the CEO → Approved →
// Paid), its totals, what each role can do next (HR: refresh, send to the CEO, mark as paid; the CEO: approve, or return
// with a reason; a Super Admin: delete a draft), the month's figures HR types (the inputs grid), the pay each employee
// gets with every step of it, who is left out and why, and the files: the payroll register any time, the CIB and ACH
// bank files once approved, and once it is paid the payslips: each employee's English one, and all of them as a ZIP
// (the Arabic one is made from the employee file). The month's additions and deductions on its lines, and any for
// people not on it (owner, 17 October 2026: Additions / Deductions), each line's on the grid as its Earnings and
// Deductions (owner, 17 October 2026: "instead of there, i think earnings and deductions will be enough"). While the
// run is with the CEO, the CEO may waive a line's attendance deduction in its row of the pay (owner, 17 October 2026:
// "if there is an attendance deduction, allow the CEO to wave the deduction by ticking a box"). Salary data: HR,
// Finance and the CEO only; the API checks every request again. The C-level people (owner, 19 October 2026: "make C
// level Employees details not visible to HR"): their lines are hidden from HR and Finance, as one row "C-level (2
// people) — hidden" on the figures and the pay, the totals, the bank files, the register and the payslips without them,
// and the page says so; the CEO and the Super Admin see the whole run, those lines marked C-level, and on a draft the
// CEO fills their figures, HR the rest (each line's `editable`, from the API; access.ts).

const LINK = 'font-medium text-accent hover:underline';

/** When the run was made and moved along: "Made 01/10/2026 · Sent to the CEO 02/10/2026 · Approved by … on …". */
function history(run: PayrollRunView): string {
  return [
    `Made ${formatDate(run.createdAt)}`,
    run.submittedAt && run.status !== 'draft' && `Sent to the CEO ${formatDate(run.submittedAt)}`,
    run.approvedAt && `Approved${run.approvedBy ? ` by ${run.approvedBy.name}` : ''} on ${formatDate(run.approvedAt)}`,
    run.paidOn && `Paid on ${formatDate(run.paidOn)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function SummaryCards({ run }: { run: PayrollRunView }) {
  const t = run.totals;
  // the C-level people's lines hidden from the caller are not in the totals (19 October 2026)
  const hidden = hiddenTotalsNote(hiddenCount(run));
  const cards: { label: string; value: string; note?: string }[] = [
    { label: 'Employees', value: String(t.employees), note: employeesNote(run.exclusions.length, hiddenCount(run)) },
    { label: 'Earned', value: formatEgp(t.earned), note: t.allowances ? `Allowances ${formatEgp(t.allowances)}` : undefined },
    { label: 'Social insurance', value: formatEgp(t.employeeInsurance), note: `Company's share ${formatEgp(t.employerInsurance)}` },
    { label: 'Income tax', value: formatEgp(t.monthlyTax) },
    { label: 'Martyrs’ fund', value: formatEgp(t.martyrsFund) },
    { label: 'Net', value: formatEgp(t.net), note: `Deductions ${formatEgp(t.deductions)}` },
    { label: 'Transfer', value: formatEgp(t.transfer), note: t.released ? `Released already ${formatEgp(t.released)}` : 'What the banks pay' },
    { label: 'Company cost', value: formatEgp(t.companyCost) },
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card px-4 py-3">
            <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{c.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{c.value}</dd>
            {c.note && <dd className="text-xs text-muted">{c.note}</dd>}
          </div>
        ))}
      </dl>
      {hidden && <p className="text-sm text-muted">{hidden}</p>}
    </div>
  );
}

function Actions({ run, user, title, payday }: { run: PayrollRunView; user: SessionUser; title: string; payday: number | null }) {
  const can = runActions(user, run.status);
  const today = todayInCairo();
  const problems = run.bankCheck.problems;
  // the register and the payslips leave out the C-level people hidden from the caller (19 October 2026)
  const excluded = filesNote(run);
  return (
    <div className="flex flex-wrap items-start gap-3">
      {can.refresh && (
        <ActionButton action={refreshRun.bind(null, run.id)} pendingText="Refreshing…">
          Refresh
        </ActionButton>
      )}
      {can.submit && (
        <ActionButton
          action={submitRun.bind(null, run.id)}
          pendingText="Sending…"
          variant="primary"
          confirmText={`Send ${title} to the CEO to approve? It can't be changed while it is with the CEO.${problems ? ` ${problems} ${problems === 1 ? 'employee has' : 'employees have'} bank details to put right first.` : ''}`}
        >
          Send to the CEO
        </ActionButton>
      )}
      {can.approve && (
        <ActionButton
          action={approveRun.bind(null, run.id)}
          pendingText="Approving…"
          variant="primary"
          confirmText={`Approve ${title}? It is locked, and the bank files can be made from it.`}
        >
          Approve
        </ActionButton>
      )}
      {can.returnToHr && <ReturnRun action={returnRun.bind(null, run.id)} title={title} />}
      {/* the payday set on Payroll Setup, in the month after the run's, to start with (owner's request, 16 October 2026) */}
      {can.markPaid && <MarkPaid action={markRunPaid.bind(null, run.id)} paidOn={paidOnDefault(run.month, payday, today)} title={title} />}
      <a href={fileHref(run.id, 'register')} className="btn btn-secondary min-h-9 px-3">
        Download register
      </a>
      {/* issued when HR marks the run paid (owner's decision, 16 October 2026) */}
      {payslipsIssued(run.status) && (
        <a href={payslipsZipHref(run.id)} className="btn btn-secondary min-h-9 px-3">
          Download payslips (ZIP)
        </a>
      )}
      {can.delete && (
        <ActionButton
          action={deleteRun.bind(null, run.id)}
          pendingText="Deleting…"
          variant="danger"
          confirmText={`Delete the draft ${title}? Its figures are deleted with it. This can't be undone.`}
        >
          Delete draft
        </ActionButton>
      )}
      {excluded && <p className="w-full text-sm text-muted">{excluded}</p>}
    </div>
  );
}

/** `runLevel`: the run's rule (HR, on a draft), for each line's `editable` when an older API leaves it out. */
function gridRows(lines: PayrollLineView[], month: string, today: string, runLevel: boolean): GridRow[] {
  return lines.map((l) => ({
    id: l.id,
    name: l.name,
    // the CEO fills the C-level people's lines, HR the rest (owner, 19 October 2026)
    confidential: l.confidential === true,
    editable: lineEditable(l, runLevel),
    // lines saved before an input existed (the leave days, 17 October 2026) have none: not given
    inputs: { ...EMPTY_PAYROLL_INPUTS, ...l.inputs },
    onHold: l.onHold,
    comments: l.comments,
    employeeId: l.employeeId,
    employeeCode: l.employeeCode,
    department: l.department,
    jobTitle: l.jobTitle,
    payBasis: l.payBasis,
    gross: l.terms.gross,
    hourlyRate: l.terms.hourlyRate,
    // missing on lines worked out before 16 October 2026
    hoursPerDay: l.terms.hoursPerDay ?? null,
    // the shift's hours less the holidays (16 October 2026): less the no-show and leave days, the expected hours the
    // cell is filled in with until HR types others (17 October 2026); none by the hour
    shiftExpectedHours: l.payBasis === 'hourly' ? null : (l.terms.expectedHours ?? null),
    // a month under two contracts (owner, 17 October 2026)
    contractsNote: contractsNote(l.terms),
    // the month's approved leave, which fills in the leave cells (18 October 2026); none on lines made before then
    leave: l.terms.leave ?? null,
    // the month's approved permission hours, counted as worked (19 October 2026); none by the hour, nor on lines made before then
    permissionHours: l.payBasis === 'hourly' ? null : (l.terms.permissionHours ?? null),
    // the month's additions and deductions, opening the person's month on Additions / Deductions (17 October 2026)
    items: lineItems(l),
    itemsHref: adjustmentsHref(month, today, l.employeeId),
    // the inputs Zoho People's attendance filled (19 October 2026), marked "from Zoho", or the month's attendance days
    // (checking in on the system, 19 October 2026), marked "from attendance"; read only
    attendanceImport: l.attendanceImport ? { fields: l.attendanceImport.fields, at: l.attendanceImport.at, source: l.attendanceImport.source ?? 'zoho' } : null,
  }));
}

/** A line's name, linked to the employee (`contract`: to their contract, on the Employment tab). */
function Person({ id, name, code, contract = false }: { id: string; name: string; code: string; contract?: boolean }) {
  return (
    <Link href={contract ? contractHref(id) : profileHref(id)} className="font-medium">
      {name}
      <span className="font-normal text-muted"> · {code}</span>
    </Link>
  );
}

function BankFiles({ run, user }: { run: PayrollRunView; user: SessionUser }) {
  const { problems, held, nothingToPay } = bankLeftOut(run.lines);
  const ready = bankFilesReady(run.status);
  const hr = preparesPayroll(user);
  // the bank files leave out the C-level people hidden from the caller (19 October 2026)
  const excluded = filesNote(run);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Bank Files</h2>
      <div className="card space-y-5 p-6">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-sm text-muted">CIB file</dt>
            <dd className="text-lg font-semibold tabular-nums">{employeesLabel(run.bankCheck.cib)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">ACH file (other banks)</dt>
            <dd className="text-lg font-semibold tabular-nums">{employeesLabel(run.bankCheck.ach)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Bank details to put right</dt>
            <dd className={`text-lg font-semibold tabular-nums ${run.bankCheck.problems ? 'text-danger' : ''}`}>{run.bankCheck.problems}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          {run.status === 'approved' || run.status === 'paid'
            ? 'From each employee’s bank details on their profile, copied onto the run when the CEO approved it: later changes to a profile don’t change these files.'
            : 'From each employee’s bank details on their profile: there is nothing to enter here. They are copied onto the run when the CEO approves it, so later changes to a profile don’t change its files.'}
        </p>
        {excluded && <p className="text-sm text-muted">{excluded}</p>}

        {problems.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Bank Details to Put Right</h3>
            <ul className="divide-y divide-line-soft rounded-lg border border-line">
              {problems.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm">
                  <span>
                    <Person id={l.employeeId} name={l.name} code={l.employeeCode} />
                    <span className="block text-danger">{l.bank.problem}</span>
                  </span>
                  <Link href={hr ? `/employees/${l.employeeId}/edit/bank` : profileHref(l.employeeId)} prefetch={false} className={`text-sm ${LINK}`}>
                    {hr ? 'Edit bank details' : 'Open the profile'}
                    <span className="sr-only"> of {l.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(held.length > 0 || nothingToPay.length > 0) && (
          <div className="space-y-1 text-sm">
            <h3 className="font-semibold">Left Out of the Bank Files</h3>
            {held.length > 0 && <p>On hold this month: {held.map((l) => l.name).join(', ')}.</p>}
            {nothingToPay.length > 0 && <p>Nothing to transfer: {nothingToPay.map((l) => l.name).join(', ')}.</p>}
          </div>
        )}

        {ready ? (
          <div className="space-y-4 border-t border-line-soft pt-4">
            <CibFileForm runId={run.id} today={todayInCairo()} />
            <div>
              <a href={fileHref(run.id, 'ach')} className="btn btn-secondary">
                Download ACH file
              </a>
              <p className="hint">Every bank but CIB, through EG-ACH.</p>
            </div>
          </div>
        ) : (
          <p className="border-t border-line-soft pt-4 text-sm text-muted">The CIB and ACH files are made once the CEO approves the run.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Attendance (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it later"; then
 * "Check-in through the system (phone or web with the office location check, or a device) to replace Zoho"): the
 * month's attendance fills the lines' worked hours, no-show days and permission hours: the attendance days of those who
 * check in on the system (or whose days were corrected), marked "from attendance", with Refresh from attendance on a
 * draft (HR and the CEO); Zoho People's import for the others: on a draft, HR's Import attendance from Zoho People, and
 * the run's imports, each opening its review, where it is applied to the lines (the CEO applies the C-level people's).
 * For HR and the CEO only; nothing from an API from before.
 */
async function Attendance({ run, user }: { run: PayrollRunView; user: SessionUser }) {
  const hr = preparesPayroll(user);
  if (!hr && !user.roles.includes('ceo')) return null;
  const imports = await loadImports(run.id);
  if (imports.kind === 'unavailable' || imports.kind === 'forbidden') return null;
  const list = imports.kind === 'ok' ? imports.value : [];
  const draft = run.status === 'draft';
  if (!draft && !list.length) return null;
  const refreshes = refreshesFromAttendance(user, run.status);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Attendance</h2>
        <p className="max-w-4xl text-sm text-muted">
          The month&apos;s attendance fills the worked hours, the no-show days and the permission hours, by the system&apos;s rules: the attendance
          days of those who check in on the system, marked &ldquo;from attendance&rdquo;, and Zoho People&apos;s import for the others, marked
          &ldquo;from Zoho&rdquo;. Those figures can&apos;t be typed over: they change with the attendance, or by importing the month again or
          undoing the import on its review.
        </p>
      </div>
      {(refreshes || (hr && draft)) && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {refreshes && (
            <div className="max-w-md space-y-1">
              <ActionButton action={refreshFromAttendance.bind(null, run.id)} pendingText="Refreshing…">
                Refresh from attendance
              </ActionButton>
              <p className="text-xs text-muted">{REFRESH_FROM_ATTENDANCE_HINT}</p>
            </div>
          )}
          {hr && draft && (
            <Link href={attendanceUploadHref(run.id)} className="btn btn-secondary min-h-9 px-3">
              Import attendance from Zoho People
            </Link>
          )}
        </div>
      )}
      {imports.kind === 'failed' ? (
        <p className="text-sm text-muted">The imports couldn&apos;t be loaded. {imports.messages.join(' ')}</p>
      ) : (
        list.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Zoho People Imports</h3>
            <ImportsList runId={run.id} imports={list} />
          </div>
        )
      )}
    </section>
  );
}

function Exclusions({ run }: { run: PayrollRunView }) {
  if (run.exclusions.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Not on This Run</h2>
      <p className="text-sm text-muted">Employed in the month, but left out of the run. Refresh the run once each is put right.</p>
      <ul className="card divide-y divide-line-soft">
        {run.exclusions.map((x) => (
          <li key={x.employeeId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <Person id={x.employeeId} name={x.name} code={x.employeeCode} contract />
            <span className="text-muted">{x.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function PayrollRun({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canSeePayroll(user)) return <Empty>Only HR, Finance and the CEO can see payroll.</Empty>;
  const [run, places] = await Promise.all([loadRun(params), loadPlaces()]);
  if (!run) return <Empty>Not available yet: the server does not have payroll yet.</Empty>;

  const title = runTitle(run.month);
  const can = runActions(user, run.status);
  // the figures each line takes from the caller: HR's lines, and the CEO the C-level people's (19 October 2026)
  const editable = anyEditable(run.lines, can.editInputs);
  const hidden = hiddenRowLabel(run);
  const paid = payslipsIssued(run.status);
  // the payday, for Mark as paid to start from; only read when the run can be marked paid
  const settings = can.markPaid ? await loadPayrollSettings() : null;
  const payday = settings?.kind === 'ok' ? (settings.value.payday ?? null) : null;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <PayrollStatusBadge status={run.status} />
        </div>
        <p className="text-sm text-muted">{history(run)}</p>
        <PayrollStepper status={run.status} />
      </div>

      {run.status === 'draft' && run.returnedReason && (
        <section aria-labelledby="payroll-returned" role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <h2 id="payroll-returned" className="font-semibold">
            Returned by the CEO
          </h2>
          <p className="mt-1 whitespace-pre-line">{run.returnedReason}</p>
        </section>
      )}

      <Actions run={run} user={user} title={title} payday={payday} />
      <SummaryCards run={run} />
      <Attendance run={run} user={user} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">Monthly Figures</h2>
          <span className="text-sm text-muted">{figuresNote(run.status, run.lines, can.editInputs, hiddenCount(run))}</span>
        </div>
        {run.lines.length === 0 && !hidden ? (
          <Empty>No one is on this run.{can.refresh ? ' Refresh it once the contracts are signed.' : ''}</Empty>
        ) : (
          <InputsGrid
            key={run.status}
            rows={gridRows(run.lines, run.month, todayInCairo(), can.editInputs)}
            noShowDayMultiplier={run.rules.noShowDayMultiplier}
            editable={editable}
            save={editable ? saveRunLines.bind(null, run.id) : null}
            places={places}
            hidden={hidden}
          />
        )}
      </section>

      <RunAdjustments run={run} today={todayInCairo()} />

      {(run.lines.length > 0 || hidden) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">Pay</h2>
            {paid && (
              <span className="text-sm text-muted">
                {run.payslips !== undefined && `${payslipsIssuedLabel(run.payslips)}, in English. `}
                Each opens as a protected PDF; the Arabic one is made from the employee’s Employment tab, on Salary.
              </span>
            )}
          </div>
          <ResultsTable
            lines={run.lines}
            totals={run.totals}
            rules={run.rules}
            lawRates={run.lawRates}
            payslips={paid}
            waive={can.waiveAttendance ? setAttendanceWaiver.bind(null, run.id) : null}
            places={places}
            hidden={hidden}
          />
        </section>
      )}

      <BankFiles run={run} user={user} />
      <Exclusions run={run} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Rules Used</h2>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
          {rulesSummary(run.rules).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {run.status === 'draft' ? 'Refreshing the run takes the rules as they are now, ' : 'The rules are '}
          under <Link href="/organization/payroll">Organization → Payroll Setup</Link>.
        </p>
      </section>
    </div>
  );
}

export default function PayrollRunPage({ params }: PageProps<'/payroll/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/payroll">Payroll</BackLink>
      <Suspense fallback={<Loading />}>
        <PayrollRun params={params} />
      </Suspense>
    </div>
  );
}
