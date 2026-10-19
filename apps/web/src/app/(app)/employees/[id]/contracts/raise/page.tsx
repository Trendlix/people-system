import Link from 'next/link';
import { Suspense } from 'react';
import { RAISE_REQUESTER_LABELS } from '@trendlix/shared';
import { commentText, suggestionText } from '../../../../raise-requests/list';
import { formatDate } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import { loadEmployee } from '../../../data';
import { createRaise } from '../../../raise-actions';
import { contractHref, EditHeading, Empty, Loading, RequireHr, todayInCairo } from '../../../ui';
import { loadAllowanceTypes, loadContractSettings, loadContracts } from '../data';
import { changeOf, defaultEffectiveDate, editHref } from '../raise';
import { loadPromotionPickers, loadRaiseRequest } from '../raise-data';
import { RaiseForm, type RaiseDefaults } from '../raise-form';
import { formatEgp } from '../salary';

// Entering a raise on the current employment's signed contract in force (owner's decisions, 16 October 2026): an
// amendment or a new contract, from the 1st of a month, starting from the pay in force. It is saved as a draft, one at a
// time, which HR sends to the CEO with the contract on the Employment tab, and signs there once the CEO approves it. Not
// while a draft is waiting to be signed, or an ending of the employment is in progress. Prepared from a raise request
// (?request=<id>, from the request's own page), it is HR's approval of the request in the whole form (owner, 17 October
// 2026), for a promotion or other allowances with it: it starts with the request's reason, the month it is asked from
// (its Effective from, 17 October 2026), the gross its suggestion comes to, and its comment as the note; HR's own
// comment is required, and saving sends it to the CEO at once. It is linked to the request, so the CEO's decision on the
// raise is the request's.

const UUID = /^[0-9a-f-]{36}$/i;
/** The note a raise takes from its request: up to the note's 500 characters. */
const NOTE_MAX = 500;

type Query = { request?: string | string[] };

async function NewRaise({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const employee = await loadEmployee(params);
  const asked = (await searchParams).request;
  const requestId = typeof asked === 'string' && UUID.test(asked) ? asked : null;
  const back = contractHref(employee.id);
  const e = employee.employment;
  const [contracts, settings, allowanceTypes, lawYears, pickers, request] =
    employee.access.edit && e
      ? await Promise.all([
          loadContracts(employee.id, e.id),
          loadContractSettings(),
          loadAllowanceTypes(),
          loadLawRates(),
          loadPromotionPickers(),
          requestId ? loadRaiseRequest(employee.id, requestId) : null,
        ])
      : [null, null, [], [], null, null];
  const today = todayInCairo();
  const draft = contracts?.find((c) => c.status === 'draft');
  const active = contracts?.find((c) => c.status === 'active');
  // a request HR may prepare the raise from: this employment's, with HR, none prepared yet
  const preparable = request && request.employmentId === e?.id && request.status === 'with_hr' && !request.raise ? request : null;

  let body: React.ReactNode;
  if (!e) {
    body = <Empty>{employee.fullNameEn} has no current employment, so there is no contract to raise the pay on.</Empty>;
  } else if (!contracts || !settings || !pickers) {
    body = <Empty>Contracts are not available yet.</Empty>;
  } else if (e.employmentType === 'trainee') {
    // paid by the training agreement's stages, which payroll follows (18 October 2026; Labour Law Art. 29); renewed once
    // at most, then converted to full-time (19 October 2026)
    body = (
      <Empty>
        A trainee is paid by the stages of the training agreement, each stage&apos;s pay in its months (Labour Law Art. 29): to change the pay, renew the
        agreement once with new stages, or convert it to a full-time contract (Renew or Convert to full-time, with the contract on the{' '}
        <Link href={back}>Employment tab</Link>).
      </Empty>
    );
  } else if (e.employmentType === 'intern') {
    // the unpaid internship (19 October 2026): no wage to raise
    body = (
      <Empty>
        An intern is unpaid: the internship agreement pays no wage, only allowances. To pay a wage, convert it to a full-time contract (Convert to
        full-time, with the contract on the <Link href={back}>Employment tab</Link>).
      </Empty>
    );
  } else if (draft) {
    body = (
      <Empty>
        Version {draft.version} ({draft.number}) is still a draft: sign it, or have a Super Admin delete it, before adding a raise.{' '}
        <Link href={editHref(employee.id, draft.id, changeOf(draft, contracts))}>Change the draft</Link>, or see it with the contract on the{' '}
        <Link href={back}>Employment tab</Link>.
      </Empty>
    );
  } else if (!active) {
    body = (
      <Empty>
        A raise changes the signed contract in force: sign the contract first, with the contract on the <Link href={back}>Employment tab</Link>.
      </Empty>
    );
  } else if (e.ending?.status === 'pending_ceo' || e.ending?.status === 'approved') {
    body = <Empty>An ending of this employment is in progress: no raise while it is. Withdraw the ending first.</Empty>;
  } else {
    const defaults: RaiseDefaults = {
      way: 'amendment',
      effectiveDate: preparable?.effectiveFrom ?? defaultEffectiveDate(today, active),
      durationMonths: settings.durationMonths,
      reason: preparable?.raiseReason ?? '',
      note: preparable ? commentText(preparable).slice(0, NOTE_MAX) : '',
      newJobTitleId: '',
      newGradeId: '',
      form2From: null,
      // the pay in force, to start from
      pay: {
        payBasis: active.payBasis ?? 'monthly',
        // the decided figure to start from: the gross the request's suggestion comes to, on a monthly salary
        grossSalary: (active.payBasis !== 'hourly' && (preparable?.suggestion?.gross ?? preparable?.suggestedGross)) || active.grossSalary,
        hourlyRate: active.hourlyRate ?? null,
        hoursPerWeek: active.hoursPerWeek ?? null,
        daysPerWeek: active.daysPerWeek ?? null,
        basicPercent: active.basicPercent ?? 80,
        netSalary: active.netSalary,
        allowances: active.allowances ?? [],
      },
    };
    body = (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">
          A raise on version {active.version} ({active.number}), the contract in force
          {active.endDate ? ` from ${formatDate(active.startDate)} to ${formatDate(active.endDate)}` : ` since ${formatDate(active.startDate)}`}
          {active.grossSalary !== null && `, paying a gross of ${formatEgp(active.grossSalary)} a month`}.{' '}
          {preparable
            ? 'Sign it with the contract on the Employment tab once the CEO approves it.'
            : 'It is saved as a draft: send it to the CEO with the contract on the Employment tab, and sign it there once the CEO approves it.'}
        </p>
        {requestId &&
          (preparable ? (
            <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
              Approving the raise request by {RAISE_REQUESTER_LABELS[preparable.requester].toLowerCase()}
              {preparable.requestedBy && ` (${preparable.requestedBy.email})`} on {formatDate(preparable.createdAt)}
              {suggestionText(preparable.suggestion ?? null) && `, suggesting ${suggestionText(preparable.suggestion ?? null)}`}. The gross starts from what it
              suggests, the date from the month it is asked from and the note from its comment. Saving approves it with your comment and sends the raise to the CEO at once; the CEO&apos;s
              decision on the raise is the request&apos;s.
            </p>
          ) : (
            <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              The raise request can&apos;t be prepared here: it isn&apos;t this employment&apos;s, isn&apos;t with HR any more, or a raise is already prepared
              from it. This raise is entered on its own.
            </p>
          ))}
        <RaiseForm
          action={createRaise.bind(null, employee.id, e.id)}
          defaults={defaults}
          current={active}
          allowanceTypes={allowanceTypes}
          fullTime={e.employmentType === 'full_time'}
          today={today}
          lawYears={lawYears}
          promotion={{ ...pickers, jobTitle: e.jobTitle, grade: e.grade }}
          request={preparable ? { id: preparable.id, requester: preparable.requester } : undefined}
          cancelHref={back}
          submitLabel={preparable ? 'Approve and send to the CEO' : 'Save the raise draft'}
        />
      </div>
    );
  }

  return (
    <>
      <EditHeading profile={employee} title="Pay Raise" backHref={back} />
      <RequireHr profile={employee}>{body}</RequireHr>
    </>
  );
}

export default function NewRaisePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewRaise params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
