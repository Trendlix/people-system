import { Suspense } from 'react';
import { LABELS, sourceOf, type PublicCareers, type PublicVacancyView } from '@trendlix/shared';
import { RichText } from '@/components/rich-text';
import { getBrand } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { publicGet } from '@/lib/public-api';
import { factsLine, CAREERS_PATH } from '../careers';
import { CompanyHeader, Notice, type CareersBrand } from '../ui';
import { applyForJob } from './actions';
import { ApplyForm } from './apply-form';

// A job on the careers page (owner, 22 October 2026: "where will we include the ATS?"): what it is (the facts, about the
// role, the responsibilities, the requirements: never the salary range), and its application form. The link a channel
// is shared with carries ?src= (LinkedIn, Facebook groups, job boards …), kept with the application. A job no longer open
// says so.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Section({ title, html }: { title: string; html: string | null }) {
  if (!html) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <RichText html={html} />
    </section>
  );
}

async function Job({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const src = Array.isArray(query.src) ? query.src[0] : query.src;
  const [result, careers, logo] = await Promise.all([publicGet<PublicVacancyView>(`/careers/${encodeURIComponent(slug)}`), publicGet<PublicCareers>('/careers'), getBrand()]);
  const company = careers.ok ? careers.data.company : null;
  const brand: CareersBrand = { nameEn: company?.nameEn || logo.nameEn, nameAr: company?.nameAr ?? logo.nameAr, logoVersion: logo.logoVersion, thumbnailVersion: logo.thumbnailVersion };
  if (!result.ok) {
    return (
      <Notice brand={brand} title={result.status === 404 ? 'This Job Is No Longer Open' : "This Job Can't Be Shown Right Now"}>
        <p>{result.status === 404 ? 'It may have been filled or closed.' : 'Please try again in a few minutes.'}</p>
        <p>
          <a href={CAREERS_PATH}>See the open jobs</a>
        </p>
      </Notice>
    );
  }
  const job = result.data;
  return (
    <>
      <CompanyHeader brand={brand} />
      <div className="space-y-6">
        <article className="card space-y-6 p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{job.title}</h1>
            <p className="text-sm text-muted">{factsLine([job.department, LABELS.employmentType[job.employmentType], LABELS.workArrangement[job.workArrangement]])}</p>
            {job.closingDate && <p className="text-xs text-muted">Apply by {formatDate(job.closingDate)}</p>}
          </div>
          <Section title="About the Role" html={job.about} />
          <Section title="Responsibilities" html={job.responsibilities} />
          <Section title="Requirements" html={job.requirements} />
        </article>
        <ApplyForm action={applyForJob.bind(null, slug, sourceOf(src))} questions={job.questions} title={job.title} />
      </div>
    </>
  );
}

export default function JobPage(props: Props) {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Loading the job…</p>}>
      <Job {...props} />
    </Suspense>
  );
}
