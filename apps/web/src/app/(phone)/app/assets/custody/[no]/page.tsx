import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { APP_ASSET_PATHS, APP_CUSTODY_PATHS } from '@/lib/asset-paths';
import { todayInCairo } from '../../../../../(app)/employees/ui';
import { custodyCodeFromParam, kindText } from '../../../../../(app)/assets/custody';
import { loadCustodyRecord } from '../../../../../(app)/assets/custody-data';
import { CustodyStatusBadge } from '../../../../../(app)/assets/custody-ui';
import { custodyDoneText, CustodyDetail, skippedOf } from '../../../../../(app)/assets/custody/custody-detail';
import { assetsCaller, assetsNotLoaded } from '../../../../../(app)/assets/data';
import { PhoneCard, PhoneLoading, Quiet } from '../../../ui';

// A custody record in the phone layout (Assets step 3, the brief: "for custodians: hand over and receive back in the
// phone layout, reusing the forms and the camera for the signed copy"): the site's record inside the app opens here, and
// the custodians' notifications too. Its items and their returns, Take a photo of the signed form, and Receive back; the
// form itself is printed from the site.

export const metadata: Metadata = { title: 'Custody Record · Trendlix People' };

type Props = PageProps<'/app/assets/custody/[no]'>;

async function Record({ params, searchParams }: { params: Props['params']; searchParams: Props['searchParams'] }) {
  const [{ no }, query] = await Promise.all([params, searchParams]);
  const code = custodyCodeFromParam(no);
  if (!code) notFound();
  if (code !== no) redirect(APP_CUSTODY_PATHS.record(code));
  const { can } = await assetsCaller();
  if (!can.view) {
    return (
      <PhoneCard>
        <Quiet>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Quiet>
      </PhoneCard>
    );
  }
  const loaded = await loadCustodyRecord(code);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') {
    return (
      <PhoneCard>
        <Quiet>{assetsNotLoaded(loaded, 'custody record')}</Quiet>
      </PhoneCard>
    );
  }
  const r = loaded.value;
  return (
    <>
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-semibold">
          {r.code} <CustodyStatusBadge status={r.status} />
        </h1>
        <p className="text-sm text-muted">
          {kindText(r.kind)} · {r.employee.fullNameEn}
        </p>
      </div>
      <CustodyDetail record={r} surface="app" today={todayInCairo()} done={custodyDoneText(typeof query.done === 'string' ? query.done : null, skippedOf(query.skipped))} />
    </>
  );
}

export default function PhoneCustodyRecordPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Link href={APP_ASSET_PATHS.list} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
        <span aria-hidden="true">←</span> Assets
      </Link>
      <Suspense fallback={<PhoneLoading rows={4} />}>
        <Record params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
