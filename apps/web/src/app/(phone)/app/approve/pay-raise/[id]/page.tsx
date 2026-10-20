import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { loadLawRates } from '@/lib/law-rates';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import { appBack } from '@/lib/surface';
import { getOrNull } from '../../../../../(app)/approvals/data';
import { PayRaiseCard } from '../../../../../(app)/approvals/pay-raise-card';
import { decidesRaises, PENDING_RAISES } from '../../../../../(app)/approvals/raises';
import { UUID } from '../../../../../(app)/organization/ui';
import { raiseRequestsHref } from '../../../../../(app)/raise-requests/list';
import { PageTitle, PhoneLoading } from '../../../ui';

// A pay raise with the CEO on the phone pages' To Approve (owner, 20 October 2026: the employee app; owner's decisions,
// 16 October 2026: "HR, then the CEO"): the card Approvals shows (approvals/pay-raise-card.tsx), what changes, why and
// the raise request it came from, with the CEO's decision: approve it as it reached them or with another raise, reject
// it, or return it to HR, with a comment. Once decided, back to To Approve, saying what was done. The API lets only the
// CEO decide.

export const metadata: Metadata = { title: 'Pay Raise · TrendLIX People' };

const quiet = 'card px-4 py-8 text-center text-sm text-muted';

async function Raise({ params }: { params: PageProps<'/app/approve/pay-raise/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  const raises = await getOrNull<PendingRaise[]>(PENDING_RAISES);
  if (raises === null) return <p className={quiet}>Pay raises couldn&apos;t load. Please try again in a moment.</p>;
  const r = raises.find((x) => x.id === id);
  if (!r) return <p className={quiet}>This pay raise isn&apos;t waiting any more: it was decided or returned to HR.</p>;
  const decides = decidesRaises(user);
  const [requests, rates] = await Promise.all([
    r.raise?.requestId ? getOrNull<RaiseRequest[]>(raiseRequestsHref('with_ceo')) : null,
    decides ? loadLawRates() : [],
  ]);
  return (
    <ul>
      <PayRaiseCard raise={r} request={requests?.find((q) => q.id === r.raise?.requestId) ?? null} decides={decides} rates={rates} onSite={false} />
    </ul>
  );
}

export default function PhonePayRaisePage({ params }: PageProps<'/app/approve/pay-raise/[id]'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Pay Raise" back={appBack('approve')} />
      <Suspense fallback={<PhoneLoading />}>
        <Raise params={params} />
      </Suspense>
    </div>
  );
}
