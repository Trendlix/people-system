import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { loadOwnProfile } from '../../../own-profile';
import { BackLink, Empty } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { sendWfh } from '../actions';
import { loadWfhAllowance } from '../data';
import { MY_WFH_HREF } from '../wfh';
import { NewWfhForm } from '../wfh-forms';

// A new work from home request (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"; asked, "Manager, then HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)", "A day
// before"): for someone with an employee profile and a current employment whose arrangement expects them at the office
// (Office, or Hybrid on its office days), for themself, from My Requests. Above the form "x of 2 this month · next
// possible from DD/MM/YYYY"; the day and a reason; the notice and the limits show live and the API checks them all
// again, with the day's shift, office days, holidays and leave. Once sent, the request's page opens. An arrangement that
// never needs it (Work from home, Outdoor, Indoor and outdoor), a freelancer, or asking turned off (0 a month): said so,
// no form. Shown on the site (/attendance/wfh/new) and on the phone pages (/app/requests/new/wfh), where the back link
// and Cancel go to the phone pages' My Requests and the form, once sent, opens the request there.

export function NewWfhHeading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="page-title">Work From Home</h1>
      <p className="text-muted">
        Ask to work from home on a day you would be at the office: a working day, asked a day before at the latest. Your direct manager decides it
        first (without one, your team lead, else the head of your department), then HR; each step shows on the request. It is a working day, not
        leave: you check in from home as on any day.
      </p>
    </div>
  );
}

export async function NewWfh({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const back = surface === 'site' ? { href: MY_WFH_HREF, label: 'My Requests' } : appBack(surface);
  const [profile, allowance] = await Promise.all([loadOwnProfile(user), user.employeeId ? loadWfhAllowance() : null]);
  let body: React.ReactNode;
  if (!user.employeeId || !profile) {
    body = (
      <Empty>
        {!user.employeeId
          ? `Only someone with an employee profile can ask to work from home. No employee record uses your sign-in email (${user.email}) as its work email yet: ask HR to add it to your profile.`
          : 'Your profile couldn’t be loaded. Please try again in a moment.'}
      </Empty>
    );
  } else if (!allowance || allowance.kind === 'unavailable') body = <Empty>Not available yet: the server does not have working from home yet.</Empty>;
  else if (allowance.kind !== 'ok') body = <Empty>{notLoadedText(allowance, 'work from home days')}</Empty>;
  else if (allowance.value.refusal) body = <Empty>{allowance.value.refusal}</Empty>;
  else if (!(allowance.value.daysPerMonth > 0)) body = <Empty>Working from home is turned off: Leave Setup gives no work from home days a month. Ask HR.</Empty>;
  else {
    body = (
      <NewWfhForm
        action={sendWfh}
        allowance={allowance.value}
        cancelHref={back.href}
        // a C-level person's goes to the CEO, not HR (owner, 19 October 2026: "make C level Employees details not visible to HR")
        toCeo={profile.confidential === true}
      />
    );
  }
  return (
    <>
      <NewWfhHeading back={back} />
      {body}
    </>
  );
}
