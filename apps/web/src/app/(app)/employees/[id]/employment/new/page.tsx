import Link from 'next/link';
import { Suspense } from 'react';
import { END_REASON_LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { addEmployment, hire } from '../../../employment-actions';
import { loadEmployee, loadPickers } from '../../../data';
import { EditHeading, Empty, Loading, profileHref, RequireHr, todayInCairo } from '../../../ui';
import { loadAllowanceTypes, loadContractSettings } from '../../contracts/data';
import { firstContractDefaults, noProbationAgain } from '../../contracts/first-contract';
import { EmploymentForm, HireForm } from '../employment-form';

// Hiring someone whose profile exists: their first employment, or a new one after the last ended (a rehire). One
// employment is current at a time, and a new one starts after the last one ended. Hiring is one form (owner's decision,
// 16 October 2026: "there is no point of adding employment then adding contract and no active employment without a
// contract"): the job and the first contract's terms, saved together as the employment and its contract, a draft to
// print and sign, as accepting a job offer does. With a server from before contracts, the job alone, as before.

async function AddEmployment({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  const back = profileHref(employee.id, 'employment');
  const current = employee.employment;
  const lastEnded = employee.employments.find((e) => e.endDate);
  const hiring = employee.access.edit && !current;
  const [pickers, settings, allowanceTypes, lawYears] = hiring
    ? await Promise.all([loadPickers(employee.id), loadContractSettings(), loadAllowanceTypes(), loadLawRates()])
    : [null, null, [], []];
  // probation comes once with an employer (Labour Law Art. 90): none for someone employed here before
  const employedBefore = employee.employments.length > 0;

  return (
    <>
      <EditHeading profile={employee} title={lastEnded ? 'Add a New Employment' : 'Add Employment'} backHref={back} />
      <RequireHr profile={employee}>
        {current ? (
          <Empty>
            {employee.fullNameEn} already has a current employment, since {formatDate(current.joinDate)}. To hire them again, first{' '}
            <Link href={`/employees/${employee.id}/ending/new`}>end that employment</Link>.
          </Empty>
        ) : (
          pickers && (
            <div className="max-w-3xl space-y-4">
              {lastEnded?.endDate && (
                <p className="text-sm text-muted">
                  Rehiring: the last employment ended on {formatDate(lastEnded.endDate)}
                  {lastEnded.endReason && ` (${END_REASON_LABELS[lastEnded.endReason].toLowerCase()})`}. The new one starts after that day; the earlier
                  ones stay in the employment history.
                </p>
              )}
              {settings ? (
                <>
                  <p className="text-sm text-muted">
                    The job, then the terms of its contract. Saving adds both: the contract as a draft, version 1, to print and sign on the Employment tab.
                  </p>
                  <HireForm
                    pickers={pickers}
                    contract={{
                      action: hire.bind(null, employee.id),
                      defaults: firstContractDefaults(settings, '', employedBefore),
                      allowanceTypes,
                      probationHint: employedBefore ? noProbationAgain(employee.fullNameEn) : undefined,
                      today: todayInCairo(),
                      lawYears,
                      cancelHref: back,
                      submitLabel: 'Add employment and contract',
                    }}
                  />
                </>
              ) : (
                <EmploymentForm action={addEmployment.bind(null, employee.id)} pickers={pickers} cancelHref={back} submitLabel="Add employment" />
              )}
            </div>
          )
        )}
      </RequireHr>
    </>
  );
}

export default function AddEmploymentPage({ params }: PageProps<'/employees/[id]/employment/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <AddEmployment params={params} />
      </Suspense>
    </div>
  );
}
