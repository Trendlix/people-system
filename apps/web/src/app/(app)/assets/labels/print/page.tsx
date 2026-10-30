import { LABEL_SHEET, labelSheetSlots } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getBrand } from '@/lib/api';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { assetQrSvg } from '@/lib/asset-qr';
import { BackLink } from '../../../organization/ui';
import { readLabelPrint, sheetsText } from '../../counts';
import { assetsCaller, assetsNotLoaded } from '../../data';
import { LABEL_CSS, labelSheetsDocument, sheetMarkup, SHEET_CSS, type LabelContent } from '../../label';
import { PrintDocumentButton } from '../../label-actions';
import { MarkPrintedForm } from '../../labels-ui';
import { markLabelsPrinted } from '../../step5-actions';
import { loadLabelsFor } from '../../step5-data';
import { Empty, Loading, NoAccess } from '../../ui';

// The label sheets to print (Assets step 5; owner, 22 October 2026: "label sheets"): the labels ticked, from the label
// chosen to start at, on A4 sheets of 24, shown here at half their size; Print sheets prints them from a frame (nothing
// else of the page); once they came out right and are stuck on, Mark as labelled (a custodian or a manager).

export const metadata: Metadata = { title: 'Print Label Sheets · People System' };

async function Sheets({ searchParams }: { searchParams: PageProps<'/assets/labels/print'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const { codes, start, startProblem } = readLabelPrint(params);
  if (!codes.length) return <Empty>Choose the labels to print on Label Sheets.</Empty>;
  const [loaded, brand] = await Promise.all([loadLabelsFor(codes), getBrand()]);
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'labels')}</Empty>;
  const assets = loaded.value;
  if (!assets.length) return <Empty>None of the labels chosen is in the register now.</Empty>;
  const labels: LabelContent[] = await Promise.all(assets.map(async (a) => ({ code: a.code, name: a.name, company: brand.nameEn, qrSvg: await assetQrSvg(a.code) })));
  const sheets = labelSheetSlots(labels, start);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Print Label Sheets</h1>
        <p className="mt-1 text-sm text-muted">
          {sheetsText(labels.length, start)}
          {start > 1 ? `, starting at label ${start}` : ''}. Print on A4 label paper at 100% (&ldquo;Actual size&rdquo;), with no scaling or margins added by the printer.
        </p>
        {startProblem && (
          <p role="alert" className="mt-1 text-sm text-warn">
            {startProblem} Starting at label 1.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <PrintDocumentButton document={labelSheetsDocument(labels, start)} title="Asset label sheets" label="Print sheets" what="label sheets" />
        {can.register && <MarkPrintedForm codes={assets.map((a) => a.code)} action={markLabelsPrinted} />}
      </div>
      <section aria-label="The sheets, at half their size" className="space-y-4 overflow-x-auto">
        <style>{`${LABEL_CSS}${SHEET_CSS}`}</style>
        {sheets.map((places, i) => (
          <div key={i}>
            <p className="mb-1 text-xs text-muted">
              Sheet {i + 1} of {sheets.length}
            </p>
            <div className="inline-block border border-line shadow-sm" style={{ zoom: 0.5 }} dangerouslySetInnerHTML={{ __html: sheetMarkup(places) }} />
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">Up to {LABEL_SHEET.maxLabels} labels at once.</p>
    </div>
  );
}

export default function PrintLabelSheetsPage({ searchParams }: PageProps<'/assets/labels/print'>) {
  return (
    <div className="max-w-4xl space-y-4">
      <BackLink href={ASSET_PATHS.labels}>Label sheets</BackLink>
      <Suspense fallback={<Loading />}>
        <Sheets searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
