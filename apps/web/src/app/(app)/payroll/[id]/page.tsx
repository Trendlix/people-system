import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { PayrollLineView, PayrollRunView, SessionUser } from '@/lib/types';
import { ActionButton } from '../../employees/[id]/contracts/contract-buttons';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { profileHref, todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { approveRun, deleteRun, markRunPaid, refreshRun, returnRun, saveRunLines, submitRun } from '../actions';
import { loadRun } from '../data';
import { bankFilesReady, bankLeftOut, fileHref } from '../files';
import { canSeePayroll, employeesLabel, preparesPayroll, rulesSummary, runActions, runTitle } from '../list';
import { payslipsIssued, payslipsIssuedLabel, payslipsZipHref } from '../payslips';
import { PayrollStatusBadge, PayrollStepper } from '../ui';
import { CibFileForm } from './downloads';
import { InputsGrid, type GridRow } from './inputs-grid';
import { ResultsTable } from './results-table';
import { MarkPaid, ReturnRun } from './run-actions';

// One month's payroll run (owner's decisions, 16 October 2026): where it stands (Draft → With the CEO → Approved →
// Paid), its totals, what each role can do next (HR: refresh, send to the CEO, mark as paid; the CEO: approve, or return
// with a reason; a Super Admin: delete a draft), the month's figures HR types (the inputs grid), the pay each employee
// gets with every step of it, who is left out and why, and the files: the payroll register any time, the CIB and ACH
// bank files once approved, and once it is paid the payslips: each employee's English one, and all of them as a ZIP
// (the Arabic one is made from the employee file). Salary data: HR, Finance and the CEO only; the API checks every
// request again.

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
  const cards: { label: string; value: string; note?: string }[] = [
    { label: 'Employees', value: String(t.employees), note: run.exclusions.length ? `${run.exclusions.length} left out` : undefined },
    { label: 'Earned', value: formatEgp(t.earned), note: t.allowances ? `Allowances ${formatEgp(t.allowances)}` : undefined },
    { label: 'Social insurance', value: formatEgp(t.employeeInsurance), note: `Company's share ${formatEgp(t.employerInsurance)}` },
    { label: 'Income tax', value: formatEgp(t.monthlyTax) },
    { label: 'Martyrs’ fund', value: formatEgp(t.martyrsFund) },
    { label: 'Net', value: formatEgp(t.net), note: `Deductions ${formatEgp(t.deductions)}` },
    { label: 'Transfer', value: formatEgp(t.transfer), note: t.released ? `Released already ${formatEgp(t.released)}` : 'What the banks pay' },
    { label: 'Company cost', value: formatEgp(t.companyCost) },
  ];
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
      {cards.map((c) => (
        <div key={c.label} className="card px-4 py-3">
          <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{c.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{c.value}</dd>
          {c.note && <dd className="text-xs text-muted">{c.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Actions({ run, user, title }: { run: PayrollRunView; user: SessionUser; title: string }) {
  const can = runActions(user, run.status);
  const today = todayInCairo();
  const problems = run.bankCheck.problems;
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
      {can.markPaid && <MarkPaid action={markRunPaid.bind(null, run.id)} today={today} title={title} />}
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
    </div>
  );
}

/** Why the grid can't be changed, when it can't. */
function lockedNote(run: PayrollRunView, user: SessionUser): string | null {
  if (run.status === 'draft') return preparesPayroll(user) ? null : 'Only HR types the month’s figures.';
  if (run.status === 'pending_ceo') return 'With the CEO: the figures can’t be changed unless the CEO returns it.';
  return 'Approved: the figures are locked.';
}

function gridRows(lines: PayrollLineView[]): GridRow[] {
  return lines.map((l) => ({
    id: l.id,
    name: l.name,
    inputs: l.inputs,
    onHold: l.onHold,
    comments: l.comments,
    employeeId: l.employeeId,
    employeeCode: l.employeeCode,
    department: l.department,
    jobTitle: l.jobTitle,
    payBasis: l.payBasis,
    gross: l.terms.gross,
    hourlyRate: l.terms.hourlyRate,
  }));
}

/** A line's name, linked to the employee. */
function Person({ id, name, code, tab }: { id: string; name: string; code: string; tab?: 'contracts' }) {
  return (
    <Link href={profileHref(id, tab)} className="font-medium">
      {name}
      <span className="font-normal text-muted"> · {code}</span>
    </Link>
  );
}

function BankFiles({ run, user }: { run: PayrollRunView; user: SessionUser }) {
  const { problems, held, nothingToPay } = bankLeftOut(run.lines);
  const ready = bankFilesReady(run.status);
  const hr = preparesPayroll(user);
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
            ? 'From the bank details as they were when the CEO approved the run.'
            : 'From the bank details as they are now; they are taken as they stand when the CEO approves the run.'}
        </p>

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

function Exclusions({ run }: { run: PayrollRunView }) {
  if (run.exclusions.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Not on This Run</h2>
      <p className="text-sm text-muted">Employed in the month, but left out of the run. Refresh the run once each is put right.</p>
      <ul className="card divide-y divide-line-soft">
        {run.exclusions.map((x) => (
          <li key={x.employeeId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <Person id={x.employeeId} name={x.name} code={x.employeeCode} tab="contracts" />
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
  const run = await loadRun(params);
  if (!run) return <Empty>Not available yet: the server does not have payroll yet.</Empty>;

  const title = runTitle(run.month);
  const can = runActions(user, run.status);
  const locked = lockedNote(run, user);
  const paid = payslipsIssued(run.status);

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

      <Actions run={run} user={user} title={title} />
      <SummaryCards run={run} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">Monthly Figures</h2>
          <span className="text-sm text-muted">{locked ?? 'Typed by HR until attendance fills them.'}</span>
        </div>
        {run.lines.length === 0 ? (
          <Empty>No one is on this run.{can.refresh ? ' Refresh it once the contracts are signed.' : ''}</Empty>
        ) : (
          <InputsGrid key={run.status} rows={gridRows(run.lines)} editable={can.editInputs} save={can.editInputs ? saveRunLines.bind(null, run.id) : null} />
        )}
      </section>

      {run.lines.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">Pay</h2>
            {paid && (
              <span className="text-sm text-muted">
                {run.payslips !== undefined && `${payslipsIssuedLabel(run.payslips)}, in English. `}
                Each opens as a protected PDF; the Arabic one is made from the employee’s Contracts tab.
              </span>
            )}
          </div>
          <ResultsTable lines={run.lines} totals={run.totals} rules={run.rules} payslips={paid} />
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
          under <Link href="/organization/payroll">Organization → Payroll</Link>.
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
