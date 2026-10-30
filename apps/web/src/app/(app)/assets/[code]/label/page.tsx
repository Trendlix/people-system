import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getBrand } from '@/lib/api';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { assetQrSvg } from '@/lib/asset-qr';
import { formatDateTime } from '@/lib/format';
import { BackLink } from '../../../organization/ui';
import { markAssetLabelled } from '../../actions';
import { codeFromParam } from '../../assets';
import { assetsCaller, assetsNotLoaded, loadAsset } from '../../data';
import { LABEL_CSS, LABEL_SIZE, labelDocument, labelMarkup } from '../../label';
import { MarkLabelledForm, PrintLabelButton } from '../../label-actions';
import { Empty, Loading, NoAccess } from '../../ui';

// An asset's label (owner's brief, 21 October 2026: "print label (single label)"; spec §5: 63 × 30 mm, the QR code to
// its page, the code, the name, the company name): the label as it prints, twice its size here, Print label, and for a
// custodian or a manager Mark as labelled once it is stuck on (spec §5: "after printing set labeled_at"). Sheets of 24
// on A4 come with a later step.

export const metadata: Metadata = { title: 'Print Label · People System' };

async function Label({ params }: { params: PageProps<'/assets/[code]/label'>['params'] }) {
  const { code: raw } = await params;
  const code = codeFromParam(raw);
  if (!code) notFound();
  if (code !== raw) redirect(ASSET_PATHS.label(code));
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const [loaded, brand] = await Promise.all([loadAsset(code), getBrand()]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'asset')}</Empty>;
  const asset = loaded.value;
  const content = { code: asset.code, name: asset.name, company: brand.nameEn, qrSvg: await assetQrSvg(asset.code) };
  return (
    <>
      <BackLink href={ASSET_PATHS.asset(asset.code)}>{asset.code}</BackLink>
      <div>
        <h1 className="page-title">Print Label</h1>
        <p className="mt-1 text-sm text-muted">
          One label of {LABEL_SIZE.widthMm} × {LABEL_SIZE.heightMm} mm. Set the printer to that paper size, or print it on a label sheet. Its QR code opens
          this asset&apos;s page.
        </p>
      </div>
      <section aria-label="The label, twice its size" className="card overflow-x-auto p-6">
        <style>{LABEL_CSS}</style>
        <div className="inline-block border border-dashed border-line" style={{ zoom: 2 }} dangerouslySetInnerHTML={{ __html: labelMarkup(content) }} />
      </section>
      <div className="flex flex-wrap items-start gap-3">
        <PrintLabelButton document={labelDocument(content)} title={`Label of ${asset.code}`} />
        {asset.can.edit && <MarkLabelledForm action={markAssetLabelled.bind(null, asset.code)} labelled={!!asset.labeledAt} />}
      </div>
      <p className="text-sm text-muted">{asset.labeledAt ? `Labelled ${formatDateTime(asset.labeledAt)}.` : 'Not labelled yet.'}</p>
    </>
  );
}

export default function AssetLabelPage({ params }: PageProps<'/assets/[code]/label'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <Suspense fallback={<Loading />}>
        <Label params={params} />
      </Suspense>
    </div>
  );
}
