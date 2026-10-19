import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { actionablePeople } from '@/lib/confidential';
import { loadLawRates } from '@/lib/law-rates';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { requestRaise } from '../actions';
import { loadEmployeeRaiseRequests } from '../data';
import { canSeeRaiseRequests, isRequestForSelf, pickerOptions, preselectedPerson, readEmployee, requestablePeople, requestBackHref } from '../list';
import { RequestRaiseForm } from '../request-forms';
import { EmployeePicker } from './employee-picker';

// Asking for a raise, under Requests → Raise Requests (owner, 17 October 2026: "i think raising a request should be
// moved from the Employee tab to the raise requests tab"; asked where, the owner chose "Under Requests"). First who it is
// for, among only the people the user may ask for (as the API lets them: HR anyone employed now, a direct manager their
// direct reports, everyone themself; preselected when the address names one, ?employee=<id>, or when there is only
// themself), then the form as it was on the profile: the reason from the list, the month it is asked from ("Effective
// from"), the comment and the raise suggested (a manager a percent only), with what it comes to beside it for HR,
// Finance, the CEO and the employee for their own pay. HR, the CEO and Finance come from the Raise Requests list; the
// employee from My Requests and the dashboard; a manager from My Team. The list itself stays theirs: the employee and
// the manager reach only this page, and once sent land on their own My Requests, where the request shows. The API
// checks who may ask again. A C-level person the user sees only the card of isn't offered (owner, 19 October 2026:
// "make C level Employees details not visible to HR"): the API refuses a raise request for them.

export const metadata: Metadata = { title: 'New Raise Request · People System' };

const quiet = 'card px-6 py-6 text-sm text-muted';

/** Where the back link goes, by its address. */
const BACK_LABELS: Record<string, string> = { '/raise-requests': 'Raise Requests', '/my-requests': 'My Requests', '/my-team': 'My Team' };

function Heading({ back }: { back: string | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back}>{BACK_LABELS[back] ?? 'Back'}</BackLink>}
      <h1 className="text-2xl font-semibold">New Raise Request</h1>
      <p className="text-muted">
        Ask for a raise for yourself, for a direct report, or, from HR, for anyone employed now: a reason, the month it is to take effect from, a
        comment and the raise you suggest. HR approves or rejects it, then the CEO decides; every step is logged on the request.
      </p>
    </div>
  );
}

async function NewRequest({ searchParams }: { searchParams: PageProps<'/raise-requests/new'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  const listBack = canSeeRaiseRequests(user) ? requestBackHref(user, false) : null;
  const choices = people ? requestablePeople(user, actionablePeople(people)) : [];
  if (people === null || choices.length === 0) {
    return (
      <>
        <Heading back={listBack} />
        <Empty>
          {people === null
            ? 'The people you may ask for a raise for couldn’t be loaded. Please try again in a moment.'
            : 'There is no one you can ask for a raise for: a raise is asked for someone employed now, by themself, their direct manager or HR.'}
        </Empty>
      </>
    );
  }
  const asked = readEmployee(query);
  const chosenId = preselectedPerson(choices, asked);
  const chosen = choices.find((p) => p.id === chosenId) ?? null;
  const forSelf = chosen ? isRequestForSelf(user, chosen) : false;
  const back = listBack ?? requestBackHref(user, forSelf || choices.length === 1);
  const load = chosen ? await loadEmployeeRaiseRequests(chosen.id) : null;
  const pay = load?.kind === 'ok' ? (load.value.pay ?? null) : null;
  // the years' rates set by law, for the net in the figures (the built-in ones for those who don't read them)
  const rates = pay ? await loadLawRates() : [];

  let form: React.ReactNode = null;
  if (chosen && load) {
    if (load.kind === 'unavailable') form = <p className={quiet}>Not available yet: the server does not have raise requests yet.</p>;
    else if (load.kind === 'forbidden') form = <p className={quiet}>You can&apos;t ask for a raise for {chosen.fullNameEn}.</p>;
    else if (load.kind === 'failed') form = <p className={quiet}>Couldn&apos;t load what you may ask for {chosen.fullNameEn}. Please try again in a moment.</p>;
    else if (!load.value.canRequest) {
      form = (
        <p className={quiet}>
          {load.value.cannotRequestBecause ?? `You can't ask for a raise for ${chosen.fullNameEn} now.`} <Link href={back}>See the requests</Link>
        </p>
      );
    } else {
      const v = load.value;
      form = (
        <RequestRaiseForm
          key={chosen.id}
          action={requestRaise.bind(null, chosen.id, v.suggestsAmount)}
          suggestsAmount={v.suggestsAmount}
          forSelf={forSelf}
          name={chosen.fullNameEn}
          suggestionKinds={v.suggestionKinds}
          currentGross={v.currentGross ?? null}
          pay={pay}
          rates={rates}
          today={todayInCairo()}
          cancelHref={back}
        />
      );
    }
  }

  return (
    <>
      <Heading back={back} />
      {asked && asked !== chosenId && (
        <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          You can&apos;t ask for a raise for the person in the link: choose among the people you may ask for.
        </p>
      )}
      <EmployeePicker options={pickerOptions(user, choices)} chosen={chosenId} />
      {form}
    </>
  );
}

export default function NewRaiseRequestPage({ searchParams }: PageProps<'/raise-requests/new'>) {
  return (
    <div className="max-w-4xl space-y-5">
      <Suspense
        fallback={
          <>
            <Heading back={null} />
            <Loading />
          </>
        }
      >
        <NewRequest searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
