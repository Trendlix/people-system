import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import type { JobTitle } from '@/lib/types';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { loadJson } from '../../../payroll/load';
import { createVacancy } from '../../actions';
import { vacancyOptions } from '../../pickers';
import { managesRecruitment, NEW_VACANCY_PATH, VACANCIES_PATH } from '../../recruitment';
import { VacancyForm } from '../../vacancy-form';
import { Select } from '@/components/select';

// A new vacancy (owner, 22 October 2026: "where will we include the ATS?"): first its job title, whose job description
// fills the careers page's text, then the form. Saved as a draft: HR sends it to the CEO from its page.

export const metadata: Metadata = { title: 'New Vacancy · People System' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function NewVacancy({ searchParams }: { searchParams: PageProps<'/recruitment/vacancies/new'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!managesRecruitment(user)) return <Empty>Only HR (or a Super Admin) drafts vacancies.</Empty>;
  const options = await vacancyOptions();
  const chosen = typeof query.jobTitle === 'string' && UUID.test(query.jobTitle) ? query.jobTitle : null;
  const job = chosen ? await loadJson<JobTitle>(`/job-titles/${encodeURIComponent(chosen)}`) : null;
  if (!job || job.kind !== 'ok') {
    return (
      <form method="get" className="card max-w-xl space-y-4 p-6">
        {job && <p className="text-sm text-danger">That job title could not be read. Choose it again.</p>}
        <div>
          <label htmlFor="new-vacancy-job-title" className="label">
            Job title
          </label>
          <Select id="new-vacancy-job-title" name="jobTitle" required defaultValue="" className="input">
            <option value="">Choose…</option>
            {options.jobTitles.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
          <p className="hint">Its job description fills the careers page&apos;s text; you can change it on the next step.</p>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="btn btn-primary">
            Continue
          </button>
          <Link href={VACANCIES_PATH} className="btn btn-secondary no-underline">
            Cancel
          </Link>
        </div>
      </form>
    );
  }
  const j = job.value;
  return (
    <VacancyForm
      action={createVacancy}
      defaults={{
        jobTitleId: j.id,
        title: j.titleEn,
        gradeId: j.minGradeId && j.minGradeId === j.maxGradeId ? j.minGradeId : '',
        hiringManagerId: '',
        headcount: 1,
        employmentType: 'full_time',
        workArrangement: 'office',
        shiftId: '',
        durationMonths: 12,
        closingDate: null,
        salaryMin: null,
        salaryMax: null,
        about: j.jdPurpose ?? '',
        responsibilities: j.jdDuties ?? '',
        requirements: j.jdRequirements ?? '',
        questions: [],
      }}
      options={options}
      published={false}
      withQuestions
      cancelHref={VACANCIES_PATH}
      submitLabel="Save draft"
      jobTitleNote={
        <>
          The text below came from this job title. <Link href={NEW_VACANCY_PATH}>Start from another job title</Link>.
        </>
      }
    />
  );
}

export default function NewVacancyPage({ searchParams }: PageProps<'/recruitment/vacancies/new'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink href={VACANCIES_PATH}>Vacancies</BackLink>
        <h1 className="text-2xl font-semibold">New Vacancy</h1>
        <p className="max-w-3xl text-sm text-muted">Saved as a draft. Send it to the CEO from its page: once approved, it shows on the careers page.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewVacancy searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
