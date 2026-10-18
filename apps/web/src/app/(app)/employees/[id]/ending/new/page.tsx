import Link from 'next/link';
import { Suspense } from 'react';
import { ENDING_STATUS_LABELS, LABELS } from '@trendlix/shared';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { startEnding } from '../../../contract-actions';
import { loadEmployee } from '../../../data';
import { EditHeading, Empty, gradeLabel, Loading, profileHref, RequireHr, todayInCairo } from '../../../ui';
import { loadEndingRules } from '../../contracts/data';
import { EndingForm } from '../ending-form';

// Ending the current employment: HR records how and when it ends (which counts as HR's approval), and it goes to the
// CEO for approval. Once approved, HR completes it on or after the last working day, which ends the employment; the
// profile stays, and the person is then a former employee. `?rule=probation` comes from the probation banner.

type Query = Record<string, string | string[] | undefined>;

async function NewEnding({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [employee, query] = await Promise.all([loadEmployee(params), searchParams]);
  const back = profileHref(employee.id, 'employment');
  const e = employee.employment;
  const allRules = employee.access.edit && e ? await loadEndingRules() : null;
  const today = todayInCairo();
  const pastEndingHref = e ? `/employees/${employee.id}/employment/${e.id}/end` : '';

  let body: React.ReactNode;
  if (!e) {
    body = <Empty>{employee.fullNameEn} has no current employment to end.</Empty>;
  } else if (!allRules) {
    body = (
      <Empty>
        Not available yet: endings that go to the CEO for approval come with the server&apos;s next update. Meanwhile, an ending that already happened can be{' '}
        <Link href={pastEndingHref}>recorded directly</Link>.
      </Empty>
    );
  } else if (e.ending && (e.ending.status === 'pending_ceo' || e.ending.status === 'approved')) {
    body = (
      <Empty>
        An ending is already in progress ({e.ending.ruleLabel}, {ENDING_STATUS_LABELS[e.ending.status].toLowerCase()}), with the last working day on{' '}
        {formatDate(e.ending.lastWorkingDay)}. To record another, first withdraw it on the <Link href={back}>Employment tab</Link>.
      </Empty>
    );
  } else {
    // Probation can end only while on probation; a non-renewal needs a signed fixed-term contract, ending on its end date.
    const fixed =
      e.contract?.form === 'fixed' && e.contract.endDate ? { endDate: e.contract.endDate, nonRenewalNoticeBy: e.contract.nonRenewalNoticeBy } : null;
    const rules = allRules.filter((r) => r.active && (r.key !== 'probation' || e.status === 'probation') && (r.key !== 'non_renewal' || fixed));
    const what = [LABELS.employmentType[e.employmentType], e.jobTitle?.titleEn, e.grade && gradeLabel(e.grade), e.department && departmentName(e.department)]
      .filter(Boolean)
      .join(' · ');
    const rule = typeof query.rule === 'string' ? query.rule : undefined;

    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm">
          <span className="font-semibold">{what}</span> <span className="text-muted">since {formatDate(e.joinDate)}</span>
        </p>
        <p className="text-sm text-muted">
          Recording it counts as HR&apos;s approval; it then goes to the CEO. Once approved, complete it on the Employment tab on or after the last working day:
          that ends the employment, and {employee.fullNameEn} is then listed as a former employee, with the profile kept.
        </p>
        {employee.reports.length > 0 && (
          <div role="alert" className="space-y-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            <p>
              {employee.reports.length === 1 ? '1 person reports' : `${employee.reports.length} people report`} to {employee.fullNameEn}. Choose another manager
              for {employee.reports.length === 1 ? 'them' : 'each of them'} before the ending is completed:
            </p>
            <ul className="list-disc pl-5">
              {employee.reports.map((r) => (
                <li key={r.id}>
                  <Link href={profileHref(r.id, 'employment')}>{r.fullNameEn}</Link> ({r.employeeCode})
                </li>
              ))}
            </ul>
          </div>
        )}
        {rules.length === 0 ? (
          <Empty>No ways of ending an employment are offered. HR or Admin turn them on in Organization → Contracts &amp; Endings.</Empty>
        ) : (
          <EndingForm
            action={startEnding.bind(null, employee.id, e.id)}
            rules={rules}
            initialRule={rule}
            contract={fixed}
            probationEnd={e.status === 'probation' ? e.probationEnd : null}
            // Art. 154's estimate for a non-renewal (18 October 2026): the wage a month, the gross and the allowances
            art154={{ joinDate: e.joinDate, monthlyWage: e.contract && !e.contract.salaryHidden ? (e.contract.totalSalary ?? e.contract.grossSalary) : null }}
            today={today}
            cancelHref={back}
          />
        )}
        <p className="text-xs text-muted">
          Already ended outside People System, e.g. before it was used? <Link href={pastEndingHref}>Record a past ending</Link> instead.
        </p>
      </div>
    );
  }

  return (
    <>
      <EditHeading profile={employee} title="End Employment" backHref={back} />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function NewEndingPage({ params, searchParams }: PageProps<'/employees/[id]/ending/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewEnding params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
