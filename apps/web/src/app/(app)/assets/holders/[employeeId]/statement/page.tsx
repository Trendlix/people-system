import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../../organization/ui';
import { todayInCairo } from '../../../../employees/ui';
import { CUSTODY_FORM_CSS, custodyStatementDocument, custodyStatementMarkup } from '../../../custody-form';
import { formBrand, loadHoldings } from '../../../custody-data';
import { assetsCaller, assetsNotLoaded } from '../../../data';
import { PrintDocumentButton } from '../../../label-actions';
import { Empty, Loading, NoAccess } from '../../../ui';

// A person's custody statement to print (Assets step 3; spec §5: "employee statement (everything held)"): everything they
// hold today, on A4, with the company's name and logo and a signature line, printed alone from a frame in the page
// (custody-form.ts). Never a value.

export const metadata: Metadata = { title: 'Custody Statement · People System' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Statement({ params }: { params: PageProps<'/assets/holders/[employeeId]/statement'>['params'] }) {
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const [loaded, brand] = await Promise.all([loadHoldings(employeeId), formBrand()]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'holdings')}</Empty>;
  const h = loaded.value;
  const today = todayInCairo();
  return (
    <>
      <BackLink href={CUSTODY_PATHS.person(h.employee.id)}>{h.employee.fullNameEn}</BackLink>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Custody Statement</h1>
          <p className="mt-1 text-sm text-muted">Everything {h.employee.fullNameEn} holds today, to print on A4 and sign.</p>
        </div>
        <PrintDocumentButton document={custodyStatementDocument(h, brand, today)} title={`Custody statement of ${h.employee.fullNameEn}`} label="Print statement" what="statement" />
      </div>
      <section aria-label="The statement as it prints" className="card overflow-x-auto p-6">
        <style>{CUSTODY_FORM_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: custodyStatementMarkup(h, brand, today) }} />
      </section>
    </>
  );
}

export default function CustodyStatementPage({ params }: PageProps<'/assets/holders/[employeeId]/statement'>) {
  return (
    <div className="max-w-5xl space-y-4">
      <Suspense fallback={<Loading />}>
        <Statement params={params} />
      </Suspense>
    </div>
  );
}
