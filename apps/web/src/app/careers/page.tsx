import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS, type PublicCareers } from '@trendlix/shared';
import { getBrand } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { publicGet } from '@/lib/public-api';
import { factsLine, GENERAL_PATH, jobHref } from './careers';
import { CompanyHeader, Notice, type CareersBrand } from './ui';

// The careers page's open jobs (owner, 22 October 2026: "where will we include the ATS?"): every vacancy the CEO approved
// and whose closing date hasn't passed, newest first, each linking to its page and form. Made for a phone first.

async function OpenJobs() {
  const [result, logo] = await Promise.all([publicGet<PublicCareers>('/careers'), getBrand()]);
  if (!result.ok) {
    return (
      <Notice brand={null} title="Careers Can't Be Shown Right Now">
        <p>Please try again in a few minutes.</p>
      </Notice>
    );
  }
  const { company, vacancies } = result.data;
  const brand: CareersBrand = { nameEn: company.nameEn || logo.nameEn, nameAr: company.nameAr ?? logo.nameAr, logoVersion: logo.logoVersion, thumbnailVersion: logo.thumbnailVersion };
  return (
    <>
      <CompanyHeader brand={brand} />
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Open Jobs</h1>
        {vacancies.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-muted">No jobs are open right now. Please check again soon.</div>
        ) : (
          <ul className="space-y-3">
            {vacancies.map((v) => (
              <li key={v.slug}>
                <Link href={jobHref(v.slug)} className="card block p-5 text-ink no-underline hover:border-accent hover:text-ink">
                  <span className="block text-lg font-semibold">{v.title}</span>
                  <span className="mt-1 block text-sm text-muted">{factsLine([v.department, LABELS.employmentType[v.employmentType], LABELS.workArrangement[v.workArrangement]])}</span>
                  {v.closingDate && <span className="mt-2 block text-xs text-muted">Apply by {formatDate(v.closingDate)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {/* a CV without a posted job (owner, 22 October 2026: "what came out of the posted jobs and what cam on randomly") */}
        <Link href={GENERAL_PATH} className="card block p-5 text-ink no-underline hover:border-accent hover:text-ink">
          <span className="block text-lg font-semibold">Don’t See Your Role?</span>
          <span className="mt-1 block text-sm text-muted">Send us your CV, and we will contact you when a job fits what you do.</span>
        </Link>
      </div>
    </>
  );
}

export default function CareersPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Loading the open jobs…</p>}>
      <OpenJobs />
    </Suspense>
  );
}
