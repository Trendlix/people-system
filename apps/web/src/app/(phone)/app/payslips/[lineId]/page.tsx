import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PdfView } from '@/components/pdf-view';
import { formatDate } from '@/lib/format';
import { APP_PATHS, appPayslipHref, appPayslipPdfHref } from '@/lib/surface';
import { UUID } from '../../../../(app)/organization/ui';
import { LANGUAGE_LABELS, payslipRows } from '../../../../(app)/payroll/payslips';
import { PageTitle, PhoneLoading } from '../../ui';
import { loadMyPayslips } from '../data';

// A payslip on the phone pages (owner, 20 October 2026: the employee app, "My attendance and payslips"): drawn in the
// page (a phone's web view can't show a PDF in a frame), in English, or in Arabic on request (?language=ar: drawn the
// first time it is asked for, as on the profile: owner's decisions, 16 October 2026), with Download PDF and Open the PDF
// for a phone's own viewer. Only the caller's own: anyone else's line isn't found.

export const metadata: Metadata = { title: 'Payslip · Trendlix People' };

const back = { href: APP_PATHS.payslips, label: 'Payslips' };

async function Payslip({ params, searchParams }: { params: PageProps<'/app/payslips/[lineId]'>['params']; searchParams: PageProps<'/app/payslips/[lineId]'>['searchParams'] }) {
  const [{ lineId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(lineId)) notFound();
  const language = query.language === 'ar' ? 'ar' : 'en';
  const loaded = await loadMyPayslips();
  const row = loaded.kind === 'ok' ? payslipRows(loaded.value).find((r) => r.lineId === lineId) : undefined;
  if (!row || row.onHold) notFound();
  const other = language === 'en' ? 'ar' : 'en';
  return (
    <div className="space-y-4">
      <PageTitle title={`Payslip, ${row.title}`} back={back}>
        {row.paidOn ? `Paid on ${formatDate(row.paidOn)}. ` : ''}In {LANGUAGE_LABELS[language]}.
      </PageTitle>
      <div className="grid grid-cols-2 gap-2">
        <a href={appPayslipPdfHref(lineId, language, true)} className="btn btn-primary min-h-12">
          Download PDF
        </a>
        <Link href={appPayslipHref(lineId, other)} className="btn btn-secondary min-h-12">
          In {LANGUAGE_LABELS[other]}
        </Link>
      </div>
      <PdfView
        key={language}
        src={appPayslipPdfHref(lineId, language)}
        title={`Your payslip for ${row.title}, in ${LANGUAGE_LABELS[language]}`}
        notLoaded="The payslip could not be loaded. Please try again in a moment."
      />
      <p className="text-center text-sm">
        <a href={appPayslipPdfHref(lineId, language)} target="_blank" rel="noopener">
          Open the PDF in your phone&apos;s viewer
        </a>
      </p>
    </div>
  );
}

export default function PhonePayslipPage({ params, searchParams }: PageProps<'/app/payslips/[lineId]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <Payslip params={params} searchParams={searchParams} />
    </Suspense>
  );
}
