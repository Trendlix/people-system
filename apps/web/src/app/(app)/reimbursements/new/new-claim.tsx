import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { sendClaim } from '../actions';
import { NewClaimForm } from '../claim-forms';
import { loadMyTypes } from '../data';
import { newClaimBack } from '../list';

// A new reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific
// preset up conditions"): for anyone with an employee profile, for themself only. The employee comes from My Requests;
// HR, Finance and the CEO from Requests → Reimbursements. The types offered are those they may claim under their current
// employment (the API decides: by department, grade and employment type), each with its conditions and what is left of
// its caps; the checks show live and the API checks them again. Once sent, the claim's page opens.
// The page's heading and body, shown on the site (/reimbursements/new) and on the phone pages (/app/requests/new/reimbursement; owner, 20 October
// 2026: the employee app, "apply for their requests"), where the back link and Cancel go to the phone pages' My
// Requests and the form, once sent, opens the request there.

export function NewClaimHeading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="page-title">New Reimbursement</h1>
      <p className="text-muted">
        Claim back an expense you paid for the company: the type, the date, the amount and what it was for, with the receipts. Your direct manager
        decides it first (without one, your team lead, else the head of your department), then HR, then Finance (the CEO for a C-level person, both stages); once approved, it is paid with the next payroll, untaxed.
      </p>
    </div>
  );
}

export async function NewClaim({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const back = surface === 'site' ? newClaimBack(user) : appBack(surface);
  if (user.employeeId === null) {
    return (
      <>
        <NewClaimHeading back={back} />
        <Empty>
          Only someone with an employee profile can claim a reimbursement. No employee record uses your sign-in email ({user.email}) as its work email
          yet: ask HR to add it to your profile.
        </Empty>
      </>
    );
  }
  const today = todayInCairo();
  const types = await loadMyTypes(today);
  let body: React.ReactNode;
  if (types.kind === 'unavailable') body = <Empty>Not available yet: the server does not have reimbursements yet.</Empty>;
  else if (types.kind === 'forbidden') body = <Empty>You can&apos;t claim a reimbursement.</Empty>;
  else if (types.kind === 'failed') body = <Empty>{notLoadedText(types, 'types of expense you may claim')}</Empty>;
  else if (types.value.length === 0) {
    body = <Empty>There is no type of expense you can claim now. HR sets them up, each for the people it is for: ask HR if you expected one.</Empty>;
  } else body = <NewClaimForm action={sendClaim} types={types.value} today={today} cancelHref={back.href} />;

  return (
    <>
      <NewClaimHeading back={back} />
      {body}
    </>
  );
}
