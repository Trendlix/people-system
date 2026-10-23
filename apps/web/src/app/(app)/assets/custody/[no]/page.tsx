import { sessionKindOf } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { APP_CUSTODY_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../organization/ui';
import { todayInCairo } from '../../../employees/ui';
import { custodyCodeFromParam, kindText } from '../../custody';
import { loadCustodyRecord } from '../../custody-data';
import { CustodyStatusBadge } from '../../custody-ui';
import { assetsCaller, assetsNotLoaded } from '../../data';
import { Empty, Loading, NoAccess } from '../../ui';
import { custodyDoneText, CustodyDetail, skippedOf } from '../custody-detail';
import { joinShown } from '@/lib/hidden';

// A custody record's page on the site (Assets step 3), at /assets/custody/[no]: the address its notifications open. A
// code in lower case is sent to the code as kept. Inside the Trendlix People app (its web view says so in its user
// agent), the same record in the phone layout opens instead (/app/assets/custody/[no]), as an asset's page does.

export const metadata: Metadata = { title: 'Custody Record · People System' };

async function Record({ params, searchParams }: { params: PageProps<'/assets/custody/[no]'>['params']; searchParams: PageProps<'/assets/custody/[no]'>['searchParams'] }) {
  const [{ no }, query, h] = await Promise.all([params, searchParams, headers()]);
  const code = custodyCodeFromParam(no);
  if (!code) notFound();
  if (sessionKindOf(h.get('user-agent')) === 'app') redirect(APP_CUSTODY_PATHS.record(code));
  if (code !== no) redirect(CUSTODY_PATHS.record(code));
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const loaded = await loadCustodyRecord(code);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'custody record')}</Empty>;
  const r = loaded.value;
  const done = custodyDoneText(typeof query.done === 'string' ? query.done : null, skippedOf(query.skipped));
  return (
    <>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{r.code}</h1>
          <CustodyStatusBadge status={r.status} />
        </div>
        <p className="text-sm text-muted">
          {joinShown([kindText(r.kind), r.employee.fullNameEn, r.employee.employeeCode])}
        </p>
      </div>
      <CustodyDetail record={r} surface="site" today={todayInCairo()} done={done} />
    </>
  );
}

export default function CustodyRecordPage({ params, searchParams }: PageProps<'/assets/custody/[no]'>) {
  return (
    <div className="max-w-6xl space-y-4">
      <BackLink href={CUSTODY_PATHS.list}>Custody</BackLink>
      <Suspense fallback={<Loading />}>
        <Record params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
