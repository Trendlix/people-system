import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../../organization/ui';
import { CUSTODY_FORM_CSS, custodyFormDocument, custodyFormMarkup, custodyFormTitle } from '../../../custody-form';
import { formBrand, loadCustodyRecord } from '../../../custody-data';
import { assetsCaller, assetsNotLoaded } from '../../../data';
import { PrintDocumentButton } from '../../../label-actions';
import { Empty, Loading, NoAccess } from '../../../ui';
import { custodyCodeFromParam } from '../../../custody';

// A custody record's form to print (Assets step 3; spec §5: "custody form (check-out receipt / assignment form: items,
// terms, blank signature lines for the employee and the person handing over; return sections appended per return)"):
// the form as it prints, and Print form, which prints it alone on A4 from a frame in the page (custody-form.ts), the
// company's name and logo from Organization at its top. The paper signing: printed, signed by the employee, and its
// signed copy attached on the record's page. Printed again after a return, it carries that return's section too. Since
// 24 October 2026 in Arabic and English on one page, signed by the employee and HR (owner: "Arabic and English",
// "Employee and HR only"; custody-form.ts).

export const metadata: Metadata = { title: 'Custody Form · People System' };

async function Form({ params }: { params: PageProps<'/assets/custody/[no]/form'>['params'] }) {
  const { no } = await params;
  const code = custodyCodeFromParam(no);
  if (!code) notFound();
  if (code !== no) redirect(CUSTODY_PATHS.form(code));
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const [loaded, brand] = await Promise.all([loadCustodyRecord(code), formBrand()]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'custody record')}</Empty>;
  const r = loaded.value;
  const title = custodyFormTitle(r.kind);
  return (
    <>
      <BackLink href={CUSTODY_PATHS.record(r.code)}>{r.code}</BackLink>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            Print it on A4, have {r.employee.fullNameEn} and HR sign it, then attach a photo or a scan of the signed page on the record.
            {r.returns.length ? ' Each return is printed after the signatures, with its own signature lines.' : ''}
          </p>
        </div>
        <PrintDocumentButton document={custodyFormDocument(r, brand)} title={`${r.code} ${title}`} label="Print form" what="form" />
      </div>
      <section aria-label="The form as it prints" className="card overflow-x-auto p-6">
        <style>{CUSTODY_FORM_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: custodyFormMarkup(r, brand) }} />
      </section>
    </>
  );
}

export default function CustodyFormPage({ params }: PageProps<'/assets/custody/[no]/form'>) {
  return (
    <div className="max-w-5xl space-y-4">
      <Suspense fallback={<Loading />}>
        <Form params={params} />
      </Suspense>
    </div>
  );
}
