import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { loadEmployee } from '../../../../data';
import { updateRaise } from '../../../../raise-actions';
import { contractHref, EditHeading, Empty, Loading, RequireHr, todayInCairo } from '../../../../ui';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../../data';
import { changeOf, editHref, pendingKindLabel, stageOf, versionBefore } from '../../raise';
import { loadPromotionPickers } from '../../raise-data';
import { RaiseForm } from '../../raise-form';

// Changing a raise before it is signed (owner's decisions, 16 October 2026): a draft, one the CEO returned (sent again
// once changed), or one the CEO approved, which goes back to HR as a draft once its terms change. Not while it is with
// the CEO. A renewal with new pay is changed as a contract draft (Edit), so it is sent there.

async function EditRaise({ params }: { params: Promise<{ id: string; contractId: string }> }) {
  const { contractId } = await params;
  const employee = await loadEmployee(params);
  const back = contractHref(employee.id);
  const e = employee.employment;
  const [contracts, settings, allowanceTypes, lawYears, pickers] =
    employee.access.edit && e
      ? await Promise.all([loadContracts(employee.id, e.id), loadContractSettings(), loadAllowanceTypes(), loadLawRates(), loadPromotionPickers()])
      : [null, null, [], [], null];
  const today = todayInCairo();
  const raise = contracts?.find((c) => c.id === contractId);
  if (contracts && !raise) notFound();
  const change = raise && contracts ? changeOf(raise, contracts) : null;
  // a renewal, or the first contract: changed on the contract draft's page
  if (raise && change && change !== 'amendment' && change !== 'new_contract') redirect(editHref(employee.id, raise.id, change));
  const current = raise && contracts ? versionBefore(raise, contracts) : null;

  let body: React.ReactNode;
  if (!e || !contracts || !settings || !pickers || !raise || !change) {
    body = <Empty>{e ? 'Contracts are not available yet.' : `${employee.fullNameEn} has no current employment.`}</Empty>;
  } else if (raise.status !== 'draft') {
    body = (
      <Empty>
        Version {raise.version} ({raise.number}) was signed{raise.signedOn && ` on ${formatDate(raise.signedOn)}`}: only its filing dates and note can
        change, with the contract on the Employment tab. A change of pay is a new raise.
      </Empty>
    );
  } else if (stageOf(raise) === 'pending_ceo') {
    body = (
      <Empty>
        Version {raise.version} ({raise.number}) is with the CEO: it can&apos;t be changed unless the CEO returns it. See it with the contract on the{' '}
        <Link href={back}>Employment tab</Link>.
      </Empty>
    );
  } else if (!current || current.status !== 'active') {
    body = (
      <Empty>
        Version {raise.version - 1} is no longer the contract in force, so this raise can&apos;t go ahead. Have a Super Admin delete it, and enter the raise
        again.
      </Empty>
    );
  } else {
    const returned = raise.raise?.returnedReason;
    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">
          Draft of version {raise.version} ({raise.number}), a {pendingKindLabel(change).toLowerCase()} of version {current.version} ({current.number}). Once
          saved, send it to the CEO with the contract on the Employment tab.
        </p>
        {returned && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            The CEO returned it: {returned}
          </p>
        )}
        <RaiseForm
          action={updateRaise.bind(null, employee.id, raise.id)}
          defaults={{
            way: raise.kind === 'amendment' ? 'amendment' : 'contract',
            effectiveDate: raise.startDate,
            durationMonths: raise.durationMonths ?? settings.durationMonths,
            reason: raise.raise?.reason ?? '',
            note: raise.note ?? '',
            newJobTitleId: raise.raise?.newJobTitle?.id ?? '',
            newGradeId: raise.raise?.newGrade?.id ?? '',
            form2From: raise.raise?.form2From ?? null,
            pay: {
              payBasis: raise.payBasis ?? 'monthly',
              grossSalary: raise.grossSalary,
              hourlyRate: raise.hourlyRate ?? null,
              hoursPerWeek: raise.hoursPerWeek ?? null,
              daysPerWeek: raise.daysPerWeek ?? null,
              basicPercent: raise.basicPercent ?? 80,
              netSalary: raise.netSalary,
              allowances: raise.allowances ?? [],
            },
          }}
          current={current}
          allowanceTypes={allowanceTypes}
          fullTime={e.employmentType === 'full_time'}
          today={today}
          lawYears={lawYears}
          promotion={{ ...pickers, jobTitle: e.jobTitle, grade: e.grade }}
          approved={raise.raise?.approval === 'approved'}
          cancelHref={back}
          submitLabel="Save changes"
        />
      </div>
    );
  }

  return (
    <>
      <EditHeading profile={employee} title="Edit Pay Raise" backHref={back} />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function EditRaisePage({ params }: { params: Promise<{ id: string; contractId: string }> }) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditRaise params={params} />
      </Suspense>
    </div>
  );
}
