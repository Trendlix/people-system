import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { loadLawRates } from '@/lib/law-rates';
import { getCurrentUser } from '@/lib/session';
import { appBack } from '@/lib/surface';
import { isOpenRaise } from '../../../../../(app)/my-requests/requests';
import { RaiseCard } from '../../../../../(app)/my-requests/raise-card';
import { UUID } from '../../../../../(app)/organization/ui';
import { loadRaiseRequests } from '../../../../../(app)/raise-requests/data';
import { canSeeRaiseRequests, requestActions } from '../../../../../(app)/raise-requests/list';
import { HrRequestActions } from '../../../../../(app)/raise-requests/ui';
import { PageTitle, PhoneLoading } from '../../../ui';

// A raise request at HR's step on the phone pages' To Approve (owner, 20 October 2026: the employee app; raise requests
// "as the CEO/HR may see them"): the request's card, and HR's decision as on Raise Requests (raise-requests/ui.tsx,
// HrRequestActions): approve it as suggested or with another raise, which prepares the raise and sends it to the CEO, or
// reject it, always with a comment; a C-level person's the CEO decides. The whole raise form, and a raise prepared
// already, stay on the site (its links). Once decided the card shows where it stands; the API checks every step.

export const metadata: Metadata = { title: 'Raise Request · TrendLIX People' };

const quiet = 'card px-4 py-8 text-center text-sm text-muted';

async function Request({ params }: { params: PageProps<'/app/approve/raise/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!canSeeRaiseRequests(user)) return <p className={quiet}>Only HR, the CEO and Finance see raise requests.</p>;
  const loaded = await loadRaiseRequests('');
  if (loaded.kind === 'failed') return <p className={quiet}>The raise request couldn&apos;t be loaded. {loaded.message}</p>;
  const r = loaded.kind === 'ok' ? loaded.value.find((q) => q.id === id) : undefined;
  if (!r) notFound();
  const can = requestActions(user, r);
  const rates = can.decide ? await loadLawRates() : [];
  return (
    <div className="space-y-4">
      <ul>
        <RaiseCard item={{ kind: 'team', id: r.id, at: r.createdAt, open: isOpenRaise(r), request: r }} link={null} />
      </ul>
      {Object.values(can).some(Boolean) ? (
        <section aria-labelledby="raise-decision" className="card p-4">
          <h2 id="raise-decision" className="mb-3 font-semibold">
            Your Decision
          </h2>
          <HrRequestActions request={r} user={user} rates={rates} />
        </section>
      ) : (
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-muted">It isn&apos;t waiting for your decision now: it shows where it stands.</p>
      )}
    </div>
  );
}

export default function PhoneApproveRaiseRequestPage({ params }: PageProps<'/app/approve/raise/[id]'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Raise Request" back={appBack('approve')} />
      <Suspense fallback={<PhoneLoading />}>
        <Request params={params} />
      </Suspense>
    </div>
  );
}
