import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { updateContract } from '../../../../contract-actions';
import { loadEmployee } from '../../../../data';
import { EditHeading, Empty, Loading, profileHref, RequireHr, todayInCairo } from '../../../../ui';
import { ContractForm } from '../../contract-form';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../../data';

// Changing a draft of the current employment's contract, before it is signed. A signed version changes only in its
// filing dates and note, on the Contracts tab.

async function EditContract({ params }: { params: Promise<{ id: string; contractId: string }> }) {
  const { contractId } = await params;
  const employee = await loadEmployee(params);
  const back = profileHref(employee.id, 'contracts');
  const e = employee.employment;
  const [contracts, settings, allowanceTypes] =
    employee.access.edit && e ? await Promise.all([loadContracts(employee.id, e.id), loadContractSettings(), loadAllowanceTypes()]) : [null, null, []];
  const today = todayInCairo();
  const contract = contracts?.find((c) => c.id === contractId);
  if (contracts && !contract) notFound();

  let body: React.ReactNode;
  if (!e || !contracts || !contract) {
    body = <Empty>{e ? 'Contracts are not available yet.' : `${employee.fullNameEn} has no current employment.`}</Empty>;
  } else if (contract.status !== 'draft') {
    body = (
      <Empty>
        Version {contract.version} ({contract.number}) was signed{contract.signedOn && ` on ${formatDate(contract.signedOn)}`}: only its filing dates and note
        can change, on the Contracts tab. A change of terms is a new version.
      </Empty>
    );
  } else {
    const renewal = contract.version > 1;
    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">
          Draft of version {contract.version} ({contract.number}){renewal ? `, renewing version ${contract.version - 1}` : ''}. Sign it on the Contracts tab
          once the employee and the company have signed it.
        </p>
        <ContractForm
          action={updateContract.bind(null, employee.id, contract.id, renewal)}
          defaults={{
            startDate: contract.startDate,
            durationMonths: contract.durationMonths ?? settings?.durationMonths ?? 12,
            probationMonths: contract.probationMonths,
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
          fullTime={e.employmentType === 'full_time'}
          today={today}
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
