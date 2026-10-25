import { Suspense } from 'react';
import { LABELS, linkedinFormKey, sourceOf, type PublicVacancyView } from '@trendlix/shared';
import { RichText } from '@/components/rich-text';
import { formatDate } from '@/lib/format';
import { publicGet } from '@/lib/public-api';
import { BackLink, Loading, Notice, PageFrame, PageHead } from '../ui';
import { applyForJob } from './actions';
import { ApplyForm } from './apply-form';

// A job on the careers page (owner, 22 October 2026: "where will we include the ATS?"): what it is (the facts, about the
// role, the responsibilities, the requirements: never the salary range), and its application form. The link a channel
// is shared with carries ?src= (LinkedIn, Facebook groups, job boards …), kept with the application. A job no longer open
// says so. Dressed as trendlix.com (owner, 22 October 2026: "i need it to match the UI"; then its new design): its page
// hero (a small label, the title in big letters), the facts as its meta list, its article's headings and text. Since 25
// October 2026 (owner: "can i use linkedin to complete the data? and for creatives, they need to add their
// portfolios"): the form asks for the portfolio the vacancy asks for, and offers "Fill in with LinkedIn" when it is on;
// back from LinkedIn the address says how it went (?linkedin=), which the form reads.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Section({ title, html }: { title: string; html: string | null }) {
  if (!html) return null;
  return (
    <section className="space-y-4 border-t border-white/[0.08] pt-8 first:border-t-0 first:pt-0">
      <h2 className="careers-section-title">{title}</h2>
      <div className="careers-rich">
        <RichText html={html} />
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="careers-meta-label">{label}</dt>
      <dd className="careers-meta-value">{children}</dd>
    </div>
  );
}

async function Job({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const src = Array.isArray(query.src) ? query.src[0] : query.src;
  const returned = Array.isArray(query.linkedin) ? query.linkedin[0] : query.linkedin;
  const result = await publicGet<PublicVacancyView>(`/careers/${encodeURIComponent(slug)}`);
  if (!result.ok) {
    return (
      <Notice title={result.status === 404 ? 'This Role Is No Longer Open' : 'This Role Can’t Be Shown Right Now'} back>
        <p>{result.status === 404 ? 'It may have been filled or closed.' : 'Please try again in a few minutes.'}</p>
      </Notice>
    );
  }
  const job = result.data;
  const described = !!(job.about || job.responsibilities || job.requirements);
  return (
    <div className="careers-container">
      <BackLink />
      <PageHead crumb="Careers" title={job.title}>
        <dl className="grid gap-8 pt-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="About the role">
          {job.department && <Fact label="Department">{job.department}</Fact>}
          <Fact label="Type">{LABELS.employmentType[job.employmentType]}</Fact>
          <Fact label="Workplace">{LABELS.workArrangement[job.workArrangement]}</Fact>
          <Fact label="Apply by">{job.closingDate ? formatDate(job.closingDate) : 'Open until filled'}</Fact>
        </dl>
      </PageHead>
      <div className={`mt-12 lg:mt-16 ${described ? 'grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16' : 'max-w-3xl'}`}>
        {described && (
          <article className="space-y-8">
            <Section title="About the Role" html={job.about} />
            <Section title="Responsibilities" html={job.responsibilities} />
            <Section title="Requirements" html={job.requirements} />
          </article>
        )}
        <div>
          <ApplyForm
            action={applyForJob.bind(null, slug, sourceOf(src))}
            questions={job.questions}
            title={job.title}
            portfolio={job.portfolio}
            linkedin={{ on: job.linkedinSignIn === true, formKey: linkedinFormKey({ kind: 'job', slug }), src: src ?? null, returned: returned ?? null }}
          />
        </div>
      </div>
    </div>
  );
}

export default function JobPage(props: Props) {
  return (
    <PageFrame>
      <Suspense fallback={<Loading>Loading the role…</Loading>}>
        <Job {...props} />
      </Suspense>
    </PageFrame>
  );
}
