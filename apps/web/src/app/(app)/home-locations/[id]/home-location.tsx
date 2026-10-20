import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { appBack, appRequestsHref, type Surface } from '@/lib/surface';
import { BackLink, Empty, UUID } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { decideHome, removeHome, withdrawHome } from '../actions';
import { loadHome } from '../data';
import { HomeDecisionForm, RemoveHomeForm, WithdrawHomeForm } from '../forms';
import { decidingAsTitle, homeDoneText, homeSourceText, MY_HOMES_HREF, officeLockHint, radiusText } from '../home-locations';
import { HomeMap, HomeProgress, HomeStatusBadge, HomeTimeline } from '../ui';

// A home location request (owner, 20 October 2026: "allow other users to request to add their home locations when
// working from home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"), for its employee, HR (not a
// C-level person's), the CEO and the Super Admin; anyone else gets the 404 page, as the API says it isn't there. Its point
// on a small map with the radius's circle (while it is kept), the label, the radius, where the point came from, where it
// stands, its log of every step; while it waits for the user, their decision (HR's with the radius, the CEO's); the
// employee's Withdraw while it is being decided; Remove on an approved home (the employee's, or HR's with a comment). What
// was just done on it shows at the top (?done=). Shown on the site and on the phone pages, where the back link goes to
// the section's list and what is done on it comes back there.

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
  const back = surface !== 'site' ? appBack(surface) : own ? { href: MY_HOMES_HREF, label: 'My Requests' } : { href: '/approvals', label: 'Approvals' };
  const done = homeDoneText(query, r);
  const place = [r.employee.department, r.employee.team].filter(Boolean).join(' › ');
  const lockHint = r.employee.workArrangement ? officeLockHint({ workArrangement: r.employee.workArrangement, checkInAnywhere: r.employee.checkInAnywhere }) : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Home Location</h1>
          <HomeStatusBadge status={r.status} confidential={r.confidential} />
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
          <Section title="The Home">
            <div className="space-y-4">
              <HomeMap request={r} own={own} />
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Label">{r.label ?? <span className="text-muted">{r.latitude === null ? 'Deleted with the point' : 'None given'}</span>}</Fact>
                <Fact label="Radius">
                  <span className="tabular-nums">{radiusText(r.radiusMetres)}</span>
                  <span className="block text-xs text-muted">{r.stage === 'hr' ? 'As asked: HR sets it when approving' : 'A check-in within it shows as Home'}</span>
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
                {lockHint && !own && (
                  <Fact label="Checking in" wide>
                    {`${r.employee.fullNameEn} works at the office: while check-ins are locked to the office network, a check-in from home is still refused off it, unless you let them check in from anywhere on their profile.`}
                  </Fact>
                )}
              </dl>
              {own && (
                <p className="text-sm">
                  <Link href={surface === 'site' ? MY_HOMES_HREF : appRequestsHref('home')}>Your other home location requests are on My Requests</Link>
                </p>
              )}
            </div>
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={decidingAsTitle(r.stage, r.confidential)}>
              <HomeDecisionForm action={decideHome.bind(null, r.id, r.stage)} request={r} map={r.stage === 'hr'} />
            </Section>
          )}

          {r.canWithdraw && (
            <Section title="Withdraw the Request">
              <p className="mb-3 text-sm text-muted">While it is being decided you can withdraw it, e.g. to ask again with another point. Its point is deleted.</p>
              <WithdrawHomeForm action={withdrawHome.bind(null, r.id)} />
            </Section>
          )}

          {r.canRemove && (
            <Section title="Remove the Home Location">
              <p className="mb-3 text-sm text-muted">
                {own
                  ? 'You can remove your home at any time: its point is deleted, and your check-ins from there no longer show as Home.'
                  : 'Its point is deleted, not just hidden, and the removal is logged without it.'}
              </p>
              <RemoveHomeForm action={removeHome.bind(null, r.id, own)} own={own} name={r.employee.fullNameEn} />
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
