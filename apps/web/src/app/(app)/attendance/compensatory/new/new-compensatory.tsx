import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { loadOwnProfile } from '../../../own-profile';
import { BackLink, Empty } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { sendCompensatory } from '../actions';
import { MY_COMPENSATORY_HREF } from '../compensatory';
import { NewCompensatoryForm } from '../compensatory-forms';
import { loadCompensatoryForm } from '../data';

// A new compensatory day request (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month. and rarely to be compensated in cash"; "Manager, then HR"): for someone with an employee profile and a current
// employment (not a freelancer), for themself, from My Requests. The day worked (a rest day of their shift or an official
// holiday), the day off (a working day in the same month, a day ahead at the least) and a reason; the days show their
// checks live and the API checks them all again. Once sent, the request's page opens. Part of the day worked (owner, 27
// October 2026: "Hours off for hours worked"): its hours, what they earn by the Compensatory Setup said live, the day off's
// window the Setup's.

export function NewCompensatoryHeading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="text-2xl font-semibold">Compensatory Day</h1>
      <p className="text-muted">
        Ask for a day off in exchange for a rest day or an official holiday you worked, or hours off for part of one, a day before at the latest. Your
        direct manager decides it first (without one, your team lead, else the head of your department), then HR, who approves it as time off or,
        rarely, pays it in cash instead.
      </p>
    </div>
  );
}

export async function NewCompensatory({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const back = surface === 'site' ? { href: MY_COMPENSATORY_HREF, label: 'My Requests' } : appBack(surface);
  const [profile, form] = await Promise.all([loadOwnProfile(user), user.employeeId ? loadCompensatoryForm() : null]);
  let body: React.ReactNode;
  if (!user.employeeId || !profile) {
    body = (
      <Empty>
        {!user.employeeId
          ? `Only someone with an employee profile can ask for a compensatory day. No employee record uses your sign-in email (${user.email}) as its work email yet: ask HR to add it to your profile.`
          : 'Your profile couldn’t be loaded. Please try again in a moment.'}
      </Empty>
    );
  } else if (!form || form.kind === 'unavailable') body = <Empty>Not available yet: the server does not have compensatory days yet.</Empty>;
  else if (form.kind !== 'ok') body = <Empty>{notLoadedText(form, 'compensatory days')}</Empty>;
  else if (form.value.refusal) body = <Empty>{form.value.refusal}</Empty>;
  else {
    body = <NewCompensatoryForm action={sendCompensatory} form={form.value} cancelHref={back.href} toCeo={profile.confidential === true} />;
  }
  return (
    <>
      <NewCompensatoryHeading back={back} />
      {body}
    </>
  );
}
