import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { BackLink, Empty } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { sendOd } from '../actions';
import { loadOdForm } from '../data';
import { MY_OD_HREF } from '../od';
import { NewOdForm } from '../od-forms';

// A new official duty request (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR",
// "Ahead or up to 3 days after", "Check in from anywhere"): for someone with an employee profile and an employment (not
// a freelancer), for themself, from My Requests. The days, a full day or part of one, where and why; the timing, the
// hours against their shift, and their rest days and the official holidays show live, and the API checks them all again,
// with leave, work from home days and other official duties. A single rest day or official holiday (owner, 27 October
// 2026: "it should count in the compensatories"; "One step") is asked with its compensation, a day off or cash instead,
// decided with it. Once sent, the request's page opens. Shown on the site
// (/attendance/official-duty/new) and on the phone pages (/app/requests/new/od), where the back link and Cancel go to
// the phone pages' My Requests and the form, once sent, opens the request there.

export function NewOdHeading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="page-title">Official Duty</h1>
      <p className="text-muted">
        Ask for an official duty: work for the company away from the office, e.g. at a client&apos;s site or a shoot. Ask ahead, or up to 3 days after.
        Your direct manager decides it first (without one, your team lead, else the head of your department), then HR; each step shows on the request.
        On an approved day you check in from where you are, and the day counts as attended for its hours. On a rest day or an official holiday, ask for
        that one day with its compensation: a day off (hours off for part of the day), or cash instead.
      </p>
    </div>
  );
}

export async function NewOd({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const back = surface === 'site' ? { href: MY_OD_HREF, label: 'My Requests' } : appBack(surface);
  const form = user.employeeId ? await loadOdForm() : null;
  let body: React.ReactNode;
  if (!user.employeeId) {
    body = (
      <Empty>
        Only someone with an employee profile can ask for an official duty. No employee record uses your sign-in email ({user.email}) as its work email yet:
        ask HR to add it to your profile.
      </Empty>
    );
  } else if (!form || form.kind === 'unavailable') body = <Empty>Not available yet: the server does not have official duty yet.</Empty>;
  else if (form.kind !== 'ok') body = <Empty>{notLoadedText(form, 'official duty form')}</Empty>;
  else if (form.value.refusal) body = <Empty>{form.value.refusal}</Empty>;
  else body = <NewOdForm action={sendOd} form={form.value} cancelHref={back.href} />;
  return (
    <>
      <NewOdHeading back={back} />
      {body}
    </>
  );
}
