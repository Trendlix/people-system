import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CLIENT_FOR_EVERYONE_TEXT, HOME_TYPE_LABELS, isOpenHome } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { appBack, appRequestsHref, type Surface } from '@/lib/surface';
import { BackLink, Empty, UUID } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { decideHome, removeHome, setHomeValidity, withdrawHome } from '../actions';
import { loadHome } from '../data';
import { HomeDecisionForm, HomeValidityForm, RemoveHomeForm, WithdrawHomeForm } from '../forms';
import {
  CLIENT_LOCATIONS_HREF,
  decidingAsTitle,
  HOME_TYPE_LINES,
  homeDoneText,
  homeShownAs,
  homeSourceText,
  homeTypeOf,
  homeValidityText,
  MY_HOMES_HREF,
  officeLockHint,
  radiusText,
} from '../home-locations';
import { HomeMap, HomeOverlaps, HomeProgress, HomeStatusBadge, HomeTimeline } from '../ui';

// A home location request (owner, 20 October 2026: "allow other users to request to add their home locations when
// working from home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"), for its employee, HR (not a
// C-level person's), the CEO and the Super Admin; anyone else gets the 404 page, as the API says it isn't there. Its point
// on a small map with the radius's circle (while it is kept), the label, the radius, where the point came from, where it
// stands, its log of every step; while it waits for the user, their decision (HR's with the radius, the CEO's); the
// employee's Withdraw while it is being decided; Remove on an approved home (the employee's, or HR's with a comment). What
// was just done on it shows at the top (?done=). Shown on the site and on the phone pages, where the back link goes to
// the section's list and what is done on it comes back there. Requested check-in locations (owner, 24 October 2026:
// "(Home Location - Remote Site - Client Location) with a comment reason"; "allow the HR to add an end date or lik it to
// the contract date"; "all employees if a customer location"): its type, name, reason and the end date wished; how long
// it lasts and whether it counts now; for HR and the CEO, the check-in places it overlaps (a warning); a client
// location's "Approving makes this place count for everyone." and, once approved, where it is on Check-in Setup; HR's
// Change How Long It Lasts on an approved home or remote site.

type Query = Record<string, string | string[] | undefined>;

function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export async function HomeLocationDetail({
  params,
  searchParams,
  surface = 'site',
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Query>;
  /** The site, or the phone pages' section it is opened in. */
  surface?: Surface;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [user, loaded] = await Promise.all([getCurrentUser(), loadHome(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This home location isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'home location')}</Empty>;
  const r = loaded.value;
  const own = user.employeeId === r.employee.id;
  const type = homeTypeOf(r);
  const what = HOME_TYPE_LINES[type].toLowerCase();
  const validity = homeValidityText(r);
  const back = surface !== 'site' ? appBack(surface) : own ? { href: MY_HOMES_HREF, label: 'My Requests' } : { href: '/approvals', label: 'Approvals' };
  const done = homeDoneText(query, r);
  const place = [r.employee.department, r.employee.team].filter(Boolean).join(' › ');
  const lockHint = type === 'home' && r.employee.workArrangement ? officeLockHint({ workArrangement: r.employee.workArrangement, checkInAnywhere: r.employee.checkInAnywhere }) : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{HOME_TYPE_LABELS[type]}</h1>
          <HomeStatusBadge status={r.status} confidential={r.confidential} inForce={r.inForce} />
          {r.confidential && <CLevelBadge title="A C-level person: the CEO takes both steps, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · sent {formatDateTime(r.createdAt)}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={type === 'home' ? 'The Home' : 'The Place'}>
            <div className="space-y-4">
              {type === 'client' && isOpenHome(r.status) && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{CLIENT_FOR_EVERYONE_TEXT}</p>}
              {!own && <HomeOverlaps request={r} />}
              <HomeMap request={r} own={own} />
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Type">
                  {HOME_TYPE_LINES[type]}
                  <span className="block text-xs text-muted">{type === 'client' ? 'Counts for every employee once approved' : `Counts only for ${own ? 'you' : r.employee.fullNameEn}`}</span>
                </Fact>
                <Fact label={type === 'home' ? 'Label' : 'Name'}>{r.label ?? <span className="text-muted">{r.latitude === null ? 'Deleted with the point' : 'None given'}</span>}</Fact>
                <Fact label="Radius">
                  <span className="tabular-nums">{radiusText(r.radiusMetres)}</span>
                  <span className="block text-xs text-muted">{r.stage === 'hr' ? 'As asked: HR sets it when approving' : `A check-in within it shows as ${homeShownAs(r)}`}</span>
                </Fact>
                {r.latitude !== null && (
                  <Fact label="The point">
                    <span className="tabular-nums">
                      {r.latitude.toFixed(6)}, {r.longitude?.toFixed(6)}
                    </span>
                    <span className="block text-xs text-muted">{homeSourceText(r.accuracyMetres)}</span>
                  </Fact>
                )}
                <Fact label="Where it stands">
                  <HomeProgress request={r} />
                </Fact>
                {(validity || r.wishedEndDate) && (
                  <Fact label="How long it lasts">
                    {validity ?? <span className="text-muted">Set by HR when approving</span>}
                    {r.wishedEndDate && <span className="block text-xs text-muted">Asked until {formatDate(r.wishedEndDate)}</span>}
                    {r.status === 'approved' && r.inForce === false && <span className="block text-xs text-muted">It no longer counts for check-ins</span>}
                  </Fact>
                )}
                {r.reason && (
                  <Fact label="Reason" wide>
                    <span className="whitespace-pre-line">{r.reason}</span>
                  </Fact>
                )}
                {type === 'client' && r.status === 'approved' && (
                  <Fact label="On Check-in Setup" wide>
                    {r.location ? (
                      <>
                        {hasRole(user, 'hr', 'admin') ? <Link href={CLIENT_LOCATIONS_HREF}>{r.location.name}</Link> : r.location.name}, a client location for every employee
                        {r.location.endedAt && `, ended ${formatDate(r.location.endedAt)}`}. HR changes or ends it there.
                      </>
                    ) : (
                      'Removed from Check-in Setup: it no longer counts.'
                    )}
                  </Fact>
                )}
                {lockHint && !own && (
                  <Fact label="Checking in" wide>
                    {`${r.employee.fullNameEn} works at the office: while check-ins are locked to the office network alone, a check-in from home is still refused off it, unless you let them check in from anywhere on their profile. With check-ins locked to the check-in locations, an approved home lets their check-ins from there through.`}
                  </Fact>
                )}
              </dl>
              {own && (
                <p className="text-sm">
                  <Link href={surface === 'site' ? MY_HOMES_HREF : appRequestsHref('home')}>Your other check-in location requests are on My Requests</Link>
                </p>
              )}
            </div>
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={decidingAsTitle(r.stage, r.confidential)}>
              <HomeDecisionForm action={decideHome.bind(null, r.id, r.stage)} request={r} map={r.stage === 'hr'} />
            </Section>
          )}

          {r.canSetValidity && (
            <Section title="Change How Long It Lasts">
              <p className="mb-3 text-sm text-muted">
                {validity ? `Now: ${validity}. ` : ''}Until a date, or until {r.employee.fullNameEn}’s contract ends (it moves when the contract is renewed).
              </p>
              <HomeValidityForm action={setHomeValidity.bind(null, r.id, type)} request={r} />
            </Section>
          )}

          {r.canWithdraw && (
            <Section title="Withdraw the Request">
              <p className="mb-3 text-sm text-muted">While it is being decided you can withdraw it, e.g. to ask again with another point. Its point is deleted.</p>
              <WithdrawHomeForm action={withdrawHome.bind(null, r.id)} />
            </Section>
          )}

          {r.canRemove && (
            <Section title={type === 'home' ? 'Remove the Home Location' : 'Remove the Remote Site'}>
              <p className="mb-3 text-sm text-muted">
                {own
                  ? `You can remove your ${what} at any time: its point is deleted, and your check-ins from there no longer show as ${homeShownAs(r)}.`
                  : 'Its point is deleted, not just hidden, and the removal is logged without it.'}
              </p>
              <RemoveHomeForm action={removeHome.bind(null, r.id, own)} own={own} name={r.employee.fullNameEn} type={type} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <HomeTimeline request={r} />
        </Section>
      </div>
    </div>
  );
}
