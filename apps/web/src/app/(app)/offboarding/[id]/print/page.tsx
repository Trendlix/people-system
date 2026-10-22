import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { formBrand } from '../../../assets/custody-data';
import { PrintDocumentButton } from '../../../assets/label-actions';
import { CLEARANCE_FORM_CSS, clearanceFormDocument, clearanceFormMarkup } from '../../clearance-form';
import { loadCase, offboardingNotLoaded } from '../../data';
import { caseHref } from '../../offboarding';

// A case's Clearance Form to print (owner, 22 October 2026: the full module; the brief: "a printable Clearance Form
// with signature lines"): the form as it prints, and Print form, which prints it alone on A4 from a frame in the page,
// the company's name and logo from Organization at its top. For HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Clearance Form · People System' };

async function Form({ params }: { params: PageProps<'/offboarding/[id]/print'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [loaded, brand] = await Promise.all([loadCase(id), formBrand()]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'offboarding case')}</Empty>;
  const c = loaded.value;
  if (!c.can.manage) return <Empty>Only HR, the CEO and a Super Admin print the clearance form.</Empty>;
  return (
    <>
      <BackLink href={caseHref(c.id)}>{c.employee.fullNameEn}</BackLink>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clearance Form</h1>
          <p className="mt-1 text-sm text-muted">Print it on A4 and have {c.employee.fullNameEn} and each person in charge of an item sign it.</p>
        </div>
        <PrintDocumentButton document={clearanceFormDocument(c, brand)} title={`Clearance Form ${c.employee.fullNameEn}`} label="Print form" what="form" />
      </div>
      <section aria-label="The form as it prints" className="card overflow-x-auto p-6">
        <style>{CLEARANCE_FORM_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: clearanceFormMarkup(c, brand) }} />
      </section>
    </>
  );
}

export default function ClearanceFormPage({ params }: PageProps<'/offboarding/[id]/print'>) {
  return (
    <div className="max-w-5xl space-y-4">
      <Suspense fallback={<Loading />}>
        <Form params={params} />
      </Suspense>
    </div>
  );
}
