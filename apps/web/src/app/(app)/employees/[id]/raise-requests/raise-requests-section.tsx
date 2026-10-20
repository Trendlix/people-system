import Link from 'next/link';
import { seesRaiseRequests } from '@trendlix/shared';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { loadEmployeeRaiseRequests, type EmployeeRaiseRequestsLoad } from '../../../raise-requests/data';
import { askedAt, handlesRaiseRequests, isDirect, newRaiseRequestHref, requestPlace, showsRaiseRequests } from '../../../raise-requests/list';
import { EffectiveFrom, PreparedRaise, Progress, RaiseRequestStatusBadge, RequestLog, RequestReason, Requester, Suggestion } from '../../../raise-requests/ui';
import { ProfileSection } from '../../ui';

// Raise Requests, on the Employment tab's Salary sub-tab after the Salary History (owner, 16 October 2026: "a place to
// request raise by employee, or his manager or the HR, with a reason and to be going through an approval cycle";
// reworked 17 October 2026: "a drop list reason first ... then add requester comment, suggest raise amount or
// percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and add a comment,
// all the request steps to be logged in the request"). The employee asks for themself, their direct manager for a
// direct report, and HR for anyone: a reason from the list, a comment, and a raise suggested as an amount or a percent
// (a manager a percent only); one open per person. HR approves it as suggested or with another
// raise, which prepares the raise and sends it to the CEO, or rejects it, with a comment; the CEO's decision on that
// raise is the request's. Each request shows its log, every step with who and when. The manager is told, not asked:
// they see their reports' requests and every decision, never a figure. The employee sees their own requests' steps,
// decisions and comments and, once done, their new salary; HR, Finance and the CEO see everything. The API sends each
// only what they may see, and refuses anyone else (then this shows nothing). To the employee and their manager it is
// all the Salary sub-tab shows, so the tab reads the requests first, to know whether to offer the sub-tab, and passes
// them on. Read only since 17 October 2026 ("i think raising a request should be moved from the Employee tab to the
// raise requests tab"; the owner chose "Under Requests"): the form is under Requests → Raise Requests (Request a raise
// opens it with the person chosen), and HR decides there; each request here links to its place there (the Raise
// Requests page for HR, the CEO and Finance; My Requests for the employee's own and a manager's), with the month it is
// asked from. Since 19 October 2026 a raise HR prepared directly (on the contract, or a renewal with new pay) is listed
// too, "Prepared directly by HR", for HR, Finance and the CEO only (the API sends it no one else). A C-level person's
// request (owner, 19 October 2026: "make C level Employees details not visible to HR") says "With the CEO" while it waits
// for HR's step, which the CEO takes on Raise Requests. Since 20 October 2026 (owner: "raises not to be visible to
// employee level for now", then "Hide from managers too") nothing for someone who doesn't see raise requests
// (seesRaiseRequests, packages/shared raises.ts): the employee on their own profile, their manager on a report's.

type Profile = Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'isSelf' | 'employment'>;

const Title = ({ note, children }: { note?: string; children: React.ReactNode }) => (
  <ProfileSection title="Raise Requests" note={note}>
    {children}
  </ProfileSection>
);

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>;
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** Whether the signed-in user is this person's direct manager now (their own profile is the manager on the employment). */
const isManagerOf = (user: SessionUser, p: Profile) => !!user.employeeId && p.employment?.manager?.id === user.employeeId;

export async function RaiseRequestsSection({
  employee: p,
  user,
  loaded,
}: {
  employee: Profile;
  user: SessionUser;
  /** The requests, when the tab read them already. */
  loaded?: EmployeeRaiseRequestsLoad;
}) {
  if (!seesRaiseRequests(user)) return null;
  const load = loaded ?? (await loadEmployeeRaiseRequests(p.id));
  // not the caller's to see, a server from before raise requests, or nothing to see or ask: nothing here
  if (!showsRaiseRequests(load)) return null;
  if (load.kind !== 'ok') {
    return (
      <Title>
        <Quiet>The raise requests could not be loaded. Please try again in a moment.</Quiet>
      </Title>
    );
  }

  const { requests, canRequest, cannotRequestBecause } = load.value;
  const forSelf = Boolean(p.isSelf);
  // those who may ask are told why they can't now (e.g. one is open); the CEO and Finance only follow them
  const asks = forSelf || handlesRaiseRequests(user) || isManagerOf(user, p);
  const hidden = requests.some((r) => r.amountsHidden) && !forSelf;

  return (
    <Title
      note={
        requests.length > 0 ? `Newest first${hidden ? ' · amounts are private: you see the reasons, the comments and each decision' : ''}` : undefined
      }
    >
      {canRequest ? (
        <Link href={newRaiseRequestHref(p.id)} className="btn btn-primary">
          Request a raise<span className="sr-only">{forSelf ? ' for yourself' : ` for ${p.fullNameEn}`}</span>
        </Link>
      ) : (
        asks && cannotRequestBecause && <p className="text-sm text-muted">{cannotRequestBecause}</p>
      )}
      {requests.length === 0 ? (
        <Quiet>{forSelf ? "You haven't asked for a raise yet." : `No raise requests for ${p.fullNameEn} yet.`}</Quiet>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => {
            const place = requestPlace(user, r, forSelf);
            return (
            <li key={r.id} className="card space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm">
                  {isDirect(r) ? 'Prepared' : 'Asked'} <span className="font-medium">{askedAt(r)}</span>
                </p>
                <RaiseRequestStatusBadge status={r.status} confidential={r.confidential} />
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label="Asked by">
                  <Requester request={r} />
                </Item>
                <Item label="Effective from">
                  <EffectiveFrom request={r} />
                </Item>
                {(r.suggestion || r.suggestedGross !== null) && (
                  <Item label="Suggested raise a month">
                    <Suggestion request={r} />
                  </Item>
                )}
                <Item label={r.raiseReason ? 'Reason and comment' : 'Comment'} wide>
                  <RequestReason request={r} />
                </Item>
                {r.raise && (
                  <Item label="The raise">
                    <PreparedRaise request={r} />
                  </Item>
                )}
                <Item label="Where it stands">
                  <Progress request={r} />
                </Item>
                {(r.steps?.length ?? 0) > 0 && (
                  <Item label="Every step" wide>
                    <div className="mt-2">
                      <RequestLog request={r} />
                    </div>
                  </Item>
                )}
              </dl>
              {place && (
                <Link href={place.href} className="inline-block text-sm font-semibold">
                  {place.label}
                  <span className="sr-only"> the raise request {isDirect(r) ? 'prepared' : 'asked'} {askedAt(r)}</span>
                </Link>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </Title>
  );
}
