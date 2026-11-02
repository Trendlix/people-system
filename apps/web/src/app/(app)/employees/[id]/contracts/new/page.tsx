import Link from 'next/link';
import { Suspense } from 'react';
import { INTERN_DEFAULT_MONTHS, INTERNSHIP_AGREEMENT } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { convertToFullTime, createContract } from '../../../contract-actions';
import { loadEmployee } from '../../../data';
import { contractHref, EditHeading, Empty, Loading, RequireHr, todayInCairo } from '../../../ui';
import { ContractForm, type ContractDefaults } from '../contract-form';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../data';
import { addDays } from '../dates';
import { firstContractDefaults, noProbationAgain } from '../first-contract';
import { changeOf, editHref, versionPay } from '../raise';
import { conversionDefaults, convertHref, renewalRefusal } from '../training';
import { shownCode, withCodeInBrackets } from '@/lib/hidden';

// Drafting the current employment's contract: its first one, or the renewal of the signed one (a fixed-term or
// specific-job contract is renewed in writing; an open-ended one, since 18 October 2026, never is). It is saved as a
// draft, one at a time, and signed on the Employment tab. A renewal starts from the version it renews: its length, and
// its pay basis, salary or hourly rate and hours, working days and allowances. It asks whether the pay changes (owner's
// decisions, 16 October 2026): a renewal with new pay counts as a raise, with its reason, and the CEO approves it before
// it is signed.
//
// An intern's agreement (owner, 19 October 2026: "or can be only renewed 1 time, after that it should be
// converted to a full time contract") is renewed once: renewing it again is refused here, with the way instead. With
// ?convert=full_time (Convert to full-time on the Employment tab) the page drafts the full-time contract it converts to,
// as the employment's next version: the contract form as a full-time one (fixed-term for the settings' months, from the
// day after the agreement ends unless HR sets another day, the settings' probation unless the person had an earlier
// employment here, a gross to type, the agreement's allowances), no reason or CEO step, as it isn't a raise. Signing it
// makes the employment full-time.

type Query = Record<string, string | string[] | undefined>;

async function NewContract({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [employee, query] = await Promise.all([loadEmployee(params), searchParams]);
  const convert = query.convert === 'full_time';
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
    body = <Empty>{employee.fullNameEn} has no current employment.</Empty>;
  } else if (!contracts || !settings) {
    body = <Empty>Contracts are not available yet.</Empty>;
  } else if (convert && !draft && !previous?.training) {
    body = (
      <Empty>Only an intern&apos;s agreement is converted to a full-time contract.</Empty>
    );
  } else if (convert && !draft && previous) {
    // the full-time contract the agreement converts to: probation once with the company, none after an earlier employment
    const employedBefore = employee.employments.some((x) => x.id !== e.id);
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Version {previous.version + 1}: the full-time contract the {INTERNSHIP_AGREEMENT} (version {previous.version}
          {shownCode(previous.number) && `, ${previous.number}`}) converts
          to{previous.endDate ? `, after it ends on ${formatDate(previous.endDate)}` : ''}.
        </p>
        <ContractForm
          action={convertToFullTime.bind(null, employee.id, e.id)}
          defaults={conversionDefaults(settings, previous, employedBefore)}
          allowanceTypes={allowanceTypes}
          renewal={null}
          probationHint={employedBefore ? noProbationAgain(employee.fullNameEn) : undefined}
          employmentType="full_time"
          today={today}
          lawYears={lawYears}
          cancelHref={back}
          submitLabel="Save the full-time draft"
        />
      </div>
    );
  } else if (previous?.form === 'open_ended' && previous.status === 'active') {
    // an open-ended contract runs on, with no renewal: it ends by notice (Labour Law Art. 156)
    body = (
      <Empty>
        {withCodeInBrackets(`Version ${previous.version}`, previous.number)} is open-ended: it is never renewed.
      </Empty>
    );
  } else if (draft) {
    body = (
      <Empty>
        Version {draft.version} is already drafted. <Link href={editHref(employee.id, draft.id, changeOf(draft, contracts))}>Change the draft</Link>
      </Empty>
    );
  } else if (renewalRefusal(previous)) {
    // renewed once already (19 October 2026): converted to full-time instead, or the internship ends
    body = (
      <Empty>
        {renewalRefusal(previous)} <Link href={convertHref(employee.id)}>Convert to full-time</Link>
      </Empty>
    );
  } else {
    // Probation comes once with an employer (Art. 90): none for someone who had an employment here before.
    const hadProbation = employee.employments.some((x) => x.id !== e.id && x.probationEnd);
    // an intern is unpaid (19 October 2026): a renewal of the agreement isn't a change of pay, which would be a raise
    const intern = e.employmentType === 'intern';
    const defaults: ContractDefaults = previous
      ? {
          startDate: '',
          // a renewal goes on as the version renewed: its length, its job; an internship's months
          form: previous.form,
          durationMonths: intern ? (previous.durationMonths ?? INTERN_DEFAULT_MONTHS) : settings.durationMonths,
          jobToDo: previous.jobToDo ?? '',
          endDate: '',
          probationMonths: 0,
          // the pay so far, to start from
          payBasis: previous.payBasis ?? 'monthly',
          grossSalary: previous.grossSalary,
          hourlyRate: previous.hourlyRate ?? null,
          hoursPerWeek: previous.hoursPerWeek ?? null,
          hourlyMinimum: previous.hourlyMinimum ?? null,
          daysPerWeek: previous.daysPerWeek ?? null,
          basicPercent: previous.basicPercent ?? 80,
          netSalary: previous.netSalary,
          allowances: previous.allowances ?? [],
          note: '',
        }
      : firstContractDefaults(settings, e.joinDate, hadProbation, e.employmentType); // as Add employment starts it
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {previous
            ? `Version ${previous.version + 1}, renewing ${withCodeInBrackets(`version ${previous.version}`, previous.number)}${previous.endDate ? `, which ends on ${formatDate(previous.endDate)}` : ''}.`
            : `The first contract of the employment since ${formatDate(e.joinDate)}.`}
        </p>
        <ContractForm
          action={createContract.bind(null, employee.id, e.id, Boolean(previous))}
          defaults={defaults}
          allowanceTypes={allowanceTypes}
          renewal={previous ? { startDate: previous.endDate ? addDays(previous.endDate, 1) : null } : null}
          payChange={previous && !intern ? { version: previous.version, pay: versionPay(previous), changes: false, reason: null } : undefined}
          probationHint={hadProbation && !previous ? noProbationAgain(employee.fullNameEn) : undefined}
          employmentType={e.employmentType}
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
      <EditHeading
        profile={employee}
        title={convert && previous?.training && !draft ? 'Convert to a Full-Time Contract' : previous && !draft ? 'Renew the Contract' : 'New Contract'}
        backHref={back}
      />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function NewContractPage({ params, searchParams }: PageProps<'/employees/[id]/contracts/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewContract params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
