import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { agreementName } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { updateContract } from '../../../../contract-actions';
import { loadEmployee } from '../../../../data';
import { contractHref, EditHeading, Empty, Loading, RequireHr, todayInCairo } from '../../../../ui';
import { ContractForm } from '../../contract-form';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../../data';
import { changeOf, editHref, stageOf, versionBefore, versionPay } from '../../raise';
import { CONVERSION_PROBATION_HINT, CONVERSION_START_HINT } from '../../training';

// Changing a draft of the current employment's contract, before it is signed. A signed version changes only in its
// filing dates and note, with the contract on the Employment tab. A renewal asks whether its pay changes (owner's
// decisions, 16 October 2026): with new pay it counts as a raise, which can't change while it is with the CEO, and an
// approved one changed goes back to HR, to send to the CEO again. A raise (an amendment, or a new contract within the
// term) is changed on its own page. The full-time contract a trainee's or an intern's agreement converts to (19 October
// 2026) is changed as a full-time contract, its start date and probation too: it isn't a renewal.

async function EditContract({ params }: { params: Promise<{ id: string; contractId: string }> }) {
  const { contractId } = await params;
  const employee = await loadEmployee(params);
  const back = contractHref(employee.id);
  const e = employee.employment;
  const [contracts, settings, allowanceTypes, lawYears] =
    employee.access.edit && e
      ? await Promise.all([loadContracts(employee.id, e.id), loadContractSettings(), loadAllowanceTypes(), loadLawRates()])
      : [null, null, [], []];
  const today = todayInCairo();
  const contract = contracts?.find((c) => c.id === contractId);
  if (contracts && !contract) notFound();
  const change = contract && contracts ? changeOf(contract, contracts) : null;
  if (contract && change && (change === 'amendment' || change === 'new_contract')) redirect(editHref(employee.id, contract.id, change));
  const previous = contract && contracts ? versionBefore(contract, contracts) : null;

  let body: React.ReactNode;
  if (!e || !contracts || !contract) {
    body = <Empty>{e ? 'Contracts are not available yet.' : `${employee.fullNameEn} has no current employment.`}</Empty>;
  } else if (contract.status !== 'draft') {
    body = (
      <Empty>
        Version {contract.version} ({contract.number}) was signed{contract.signedOn && ` on ${formatDate(contract.signedOn)}`}: only its filing dates and note
        can change, with the contract on the Employment tab. A change of terms is a new version.
      </Empty>
    );
  } else if (stageOf(contract) === 'pending_ceo') {
    body = (
      <Empty>
        Version {contract.version} ({contract.number}) changes the pay and is with the CEO: it can&apos;t be changed unless the CEO returns it. See it with
        the contract on the <Link href={back}>Employment tab</Link>.
      </Empty>
    );
  } else {
    // a conversion to full-time isn't a renewal: its start date and probation are its own
    const conversion = Boolean(contract.convertsTo);
    const renewal = contract.version > 1 && !conversion;
    const raise = contract.raise;
    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">
          Draft of version {contract.version} ({contract.number})
          {conversion
            ? `, the full-time contract the ${agreementName(e.employmentType)} (version ${contract.version - 1}) converts to; signing it makes the employment full-time`
            : renewal
              ? `, renewing version ${contract.version - 1}`
              : ''}
          .{' '}
          {raise
            ? 'It changes the pay: send it to the CEO on the Employment tab, and sign it there once the CEO approves it and the employee and the company have signed it.'
            : 'Sign it on the Employment tab once the employee and the company have signed it.'}
        </p>
        {raise?.returnedReason && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            The CEO returned it: {raise.returnedReason}
          </p>
        )}
        {raise?.approval === 'approved' && (
          <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            The CEO approved its new pay. Changing its terms sends it back to HR as a draft, to send to the CEO again; changing the note alone keeps the
            approval.
          </p>
        )}
        <ContractForm
          action={updateContract.bind(null, employee.id, contract.id, renewal)}
          defaults={{
            startDate: contract.startDate,
            form: contract.form,
            durationMonths: contract.durationMonths ?? settings?.durationMonths ?? 12,
            jobToDo: contract.jobToDo ?? '',
            // a specific job's expected end (a fixed term's follows its length)
            endDate: contract.form === 'specific_job' ? (contract.endDate ?? '') : '',
            probationMonths: contract.probationMonths,
            traineeStages: contract.traineeStages ?? null,
            payBasis: contract.payBasis ?? 'monthly',
            grossSalary: contract.grossSalary,
            hourlyRate: contract.hourlyRate ?? null,
            hoursPerWeek: contract.hoursPerWeek ?? null,
            daysPerWeek: contract.daysPerWeek ?? null,
            basicPercent: contract.basicPercent ?? 80,
            netSalary: contract.netSalary,
            allowances: contract.allowances ?? [],
            note: contract.note ?? '',
          }}
          allowanceTypes={allowanceTypes}
          renewal={renewal ? { startDate: contract.startDate, after: `version ${contract.version - 1}` } : null}
          payChange={
            renewal && previous && e.employmentType !== 'intern'
              ? { version: previous.version, pay: versionPay(previous), changes: Boolean(raise), reason: raise?.reason ?? null }
              : undefined
          }
          probationHint={conversion ? CONVERSION_PROBATION_HINT : undefined}
          startHint={conversion ? CONVERSION_START_HINT : undefined}
          employmentType={conversion ? 'full_time' : e.employmentType}
          dateOfBirth={employee.dateOfBirth}
          today={today}
          lawYears={lawYears}
          cancelHref={back}
          submitLabel="Save changes"
        />
      </div>
    );
  }

  return (
    <>
      <EditHeading profile={employee} title="Edit Contract Draft" backHref={back} />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function EditContractPage({ params }: PageProps<'/employees/[id]/contracts/[contractId]/edit'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditContract params={params} />
      </Suspense>
    </div>
  );
}
