import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { createContract } from '../../../contract-actions';
import { loadEmployee } from '../../../data';
import { contractHref, EditHeading, Empty, Loading, RequireHr, todayInCairo } from '../../../ui';
import { ContractForm, type ContractDefaults } from '../contract-form';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../data';
import { addDays } from '../dates';
import { firstContractDefaults, noProbationAgain } from '../first-contract';
import { changeOf, editHref, versionPay } from '../raise';

// Drafting the current employment's contract: its first one, or the renewal of the signed one (every contract is for a
// fixed term, renewed in writing before it ends). It is saved as a draft, one at a time, and signed on the Employment
// tab. A renewal starts from the pay of the version it renews: its pay basis, salary or hourly rate and hours, working
// days and allowances. It asks whether the pay changes (owner's decisions, 16 October 2026): a renewal with new pay
// counts as a raise, with its reason, and the CEO approves it before it is signed.

async function NewContract({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  const back = contractHref(employee.id);
  const e = employee.employment;
  const [contracts, settings, allowanceTypes, lawYears] =
    employee.access.edit && e
      ? await Promise.all([loadContracts(employee.id, e.id), loadContractSettings(), loadAllowanceTypes(), loadLawRates()])
      : [null, null, [], []];
  const today = todayInCairo();
  const draft = contracts?.find((c) => c.status === 'draft');
  // the newest signed version: what a new one renews
  const previous = contracts?.find((c) => c.status !== 'draft');

  let body: React.ReactNode;
  if (!e) {
    body = <Empty>{employee.fullNameEn} has no current employment. Add the employment, which takes its contract&apos;s terms too.</Empty>;
  } else if (!contracts || !settings) {
    body = <Empty>Contracts are not available yet.</Empty>;
  } else if (draft) {
    body = (
      <Empty>
        Version {draft.version} is already drafted. <Link href={editHref(employee.id, draft.id, changeOf(draft, contracts))}>Change the draft</Link>, or
        sign it with the contract on the <Link href={back}>Employment tab</Link>. Only a Super Admin can delete it.
      </Empty>
    );
  } else {
    // Probation comes once with an employer (Art. 90): none for someone who had an employment here before.
    const hadProbation = employee.employments.some((x) => x.id !== e.id && x.probationEnd);
    const defaults: ContractDefaults = previous
      ? {
          startDate: '',
          durationMonths: settings.durationMonths,
          probationMonths: 0,
          // the pay so far, to start from
          payBasis: previous.payBasis ?? 'monthly',
          grossSalary: previous.grossSalary,
          hourlyRate: previous.hourlyRate ?? null,
          hoursPerWeek: previous.hoursPerWeek ?? null,
          daysPerWeek: previous.daysPerWeek ?? null,
          basicPercent: previous.basicPercent ?? 80,
          netSalary: previous.netSalary,
          allowances: previous.allowances ?? [],
          note: '',
        }
      : firstContractDefaults(settings, e.joinDate, hadProbation); // as Add employment starts it
    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">
          {previous
            ? `Version ${previous.version + 1}, renewing version ${previous.version} (${previous.number})${previous.endDate ? `, which ends on ${formatDate(previous.endDate)}` : ''}.`
            : `The first contract of the employment since ${formatDate(e.joinDate)}.`}{' '}
          It is saved as a draft: sign it on the Employment tab once the employee and the company have signed it.
        </p>
        <ContractForm
          action={createContract.bind(null, employee.id, e.id, Boolean(previous))}
          defaults={defaults}
          allowanceTypes={allowanceTypes}
          renewal={previous ? { startDate: previous.endDate ? addDays(previous.endDate, 1) : null, after: `version ${previous.version}` } : null}
          payChange={previous ? { version: previous.version, pay: versionPay(previous), changes: false, reason: null } : undefined}
          probationHint={hadProbation && !previous ? noProbationAgain(employee.fullNameEn) : undefined}
          fullTime={e.employmentType === 'full_time'}
          today={today}
          lawYears={lawYears}
          cancelHref={back}
          submitLabel={previous ? 'Save the renewal draft' : 'Save draft'}
        />
      </div>
    );
  }

  return (
    <>
      <EditHeading profile={employee} title={previous && !draft ? 'Renew the Contract' : 'New Contract'} backHref={back} />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function NewContractPage({ params }: PageProps<'/employees/[id]/contracts/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewContract params={params} />
      </Suspense>
    </div>
  );
}
