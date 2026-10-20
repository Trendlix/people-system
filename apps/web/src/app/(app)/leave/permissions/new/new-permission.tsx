import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { todayInCairo } from '../../../employees/ui';
import { loadOwnProfile } from '../../../own-profile';
import { BackLink, Empty } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { loadMyPermissionMonth } from '../../data';
import { sendPermission } from '../../permission-actions';
import { NewPermissionForm } from '../../permission-forms';
import { newPermissionBack, noPermissionText, PERMISSION_OFF_TEXT } from '../../permissions';

// A new permission request (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum
// 2 hours per day"; asked how it is asked for, "In the system, like leave"): for anyone with an employee profile and a
// current employment under the labour law, for themself only, from My Requests (HR and the CEO also from Leave
// Requests). Above the form what is left of this month's hours; the day, the hours in half hours, the times when given,
// a reason; the checks show live and the API checks them all again, with the day's shift, holidays and leave. Once sent,
// the request's page opens. Permission turned off in Leave Setup (0 hours a month): said so, no form.
// The page's heading and body, shown on the site (/leave/permissions/new) and on the phone pages (/app/requests/new/permission; owner, 20 October
// 2026: the employee app, "apply for their requests"), where the back link and Cancel go to the phone pages' My
// Requests and the form, once sent, opens the request there.

export function NewPermissionHeading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="text-2xl font-semibold">New Permission</h1>
      <p className="text-muted">
        Ask to be away for a few hours of a working day, e.g. to leave early or come late: the day, the hours in half hours, the times if you know them,
        and a reason. Your direct manager decides it first (without one, your team lead, else the head of your department), then HR; each step shows
        on the request. Approved, its hours count as worked.
      </p>
    </div>
  );
}

export async function NewPermission({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const back = surface === 'site' ? newPermissionBack(user) : appBack(surface);
  const profile = await loadOwnProfile(user);
  if (!profile || !profile.employment) {
    return (
      <>
        <NewPermissionHeading back={back} />
        <Empty>
          {!user.employeeId
            ? `Only someone with an employee profile can ask for permission. No employee record uses your sign-in email (${user.email}) as its work email yet: ask HR to add it to your profile.`
            : !profile
              ? 'Your profile couldn’t be loaded. Please try again in a moment.'
              : 'Permission is asked for during an employment: you have no current employment on file.'}
        </Empty>
      </>
    );
  }
  // a freelancer and an unpaid intern work outside the labour law: no leave, and no permission either (as the API says)
  const outside = noPermissionText(profile.employment.employmentType);
  if (outside) {
    return (
      <>
        <NewPermissionHeading back={back} />
        <Empty>{outside}</Empty>
      </>
    );
  }
  const today = todayInCairo();
  const month = await loadMyPermissionMonth(today.slice(0, 7));
  let body: React.ReactNode;
  if (month.kind === 'unavailable') body = <Empty>Not available yet: the server does not have permission yet.</Empty>;
  else if (month.kind !== 'ok') body = <Empty>{notLoadedText(month, 'permission hours')}</Empty>;
  else if (!(month.value.hoursPerMonth > 0)) body = <Empty>{PERMISSION_OFF_TEXT} Ask HR.</Empty>;
  else {
    body = (
      <NewPermissionForm
        action={sendPermission}
        person={{ employeeId: null, name: profile.fullNameEn }}
        initial={month.value}
        today={today}
        cancelHref={back.href}
        // a C-level person's goes to the CEO, not HR (owner, 19 October 2026: "make C level Employees details not visible to HR")
        toCeo={profile.confidential === true}
      />
    );
  }

  return (
    <>
      <NewPermissionHeading back={back} />
      {body}
    </>
  );
}
