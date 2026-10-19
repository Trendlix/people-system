import type { Metadata } from 'next';
import { Suspense } from 'react';
import { underLabourLaw } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { FREELANCE_NO_LEAVE, noLeaveText } from '../../employees/employment-law';
import { todayInCairo } from '../../employees/ui';
import { loadOwnProfile } from '../../own-profile';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { sendLeave } from '../actions';
import { loadHolidaysOf, loadLeaveTypes, loadMyBalances } from '../data';
import { NewLeaveForm } from '../leave-forms';
import { newLeaveBack } from '../list';
import { offeredTypes, personFacts } from '../request';

// A new leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): for anyone with an
// employee profile and a current employment, for themself only. The employee comes from My Requests or the dashboard; HR
// and the CEO from Requests → Leave Requests. The types offered are the active ones HR set up on Organization → Leave
// (those for the other gender left out), each with its rules in words; the days are counted live from the employee's
// shift and the official holidays, with the annual balance after it, and the checks show live; the API checks them all
// again. Once sent, the request's page opens.

export const metadata: Metadata = { title: 'New Leave · People System' };

function Heading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="text-2xl font-semibold">New Leave</h1>
      <p className="text-muted">
        Ask for leave: the type, the first and last day, and a reason, with a document when the type needs one. Your direct manager decides it first
        (without one, your team lead, else the head of your department), then HR; each step shows on the request.
      </p>
    </div>
  );
}

async function NewLeave() {
  const user = await getCurrentUser();
  const back = newLeaveBack(user);
  const profile = await loadOwnProfile(user);
  if (!profile || !profile.employment) {
    return (
      <>
        <Heading back={back} />
        <Empty>
          {!user.employeeId
            ? `Only someone with an employee profile can ask for leave. No employee record uses your sign-in email (${user.email}) as its work email yet: ask HR to add it to your profile.`
            : !profile
              ? 'Your profile couldn’t be loaded. Please try again in a moment.'
              : 'Leave is asked for during an employment: you have no current employment on file.'}
        </Empty>
      </>
    );
  }
  // a freelancer works outside the labour law (owner, 18 October 2026; Art. 1(1)), and so does an intern (19 October
  // 2026: the unpaid internship): there is no leave to ask for
  if (!underLabourLaw(profile.employment.employmentType)) {
    return (
      <>
        <Heading back={back} />
        <Empty>{noLeaveText(profile.employment.employmentType) ?? FREELANCE_NO_LEAVE}</Empty>
      </>
    );
  }
  const today = todayInCairo();
  const year = Number(today.slice(0, 4));
  const [types, balances, holidays] = await Promise.all([loadLeaveTypes(), loadMyBalances(year), loadHolidaysOf(year)]);
  const facts = personFacts(profile);
  let body: React.ReactNode;
  if (types.kind === 'unavailable') body = <Empty>Not available yet: the server does not have leave yet.</Empty>;
  else if (types.kind !== 'ok') body = <Empty>{notLoadedText(types, 'types of leave')}</Empty>;
  else {
    const offered = offeredTypes(types.value, facts.gender);
    body = offered.length ? (
      <NewLeaveForm
        action={sendLeave}
        types={offered}
        today={today}
        person={{ employeeId: null, ...facts }}
        initial={{ year, balances: balances.kind === 'ok' ? balances.value : null, holidays: holidays.kind === 'ok' ? holidays.value : [] }}
        cancelHref={back.href}
      />
    ) : (
      <Empty>No type of leave is on yet. HR sets them up: ask HR.</Empty>
    );
  }

  return (
    <>
      <Heading back={back} />
      {body}
    </>
  );
}

export default function NewLeavePage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <Heading back={null} />
            <Loading />
          </>
        }
      >
        <NewLeave />
      </Suspense>
    </div>
  );
}
