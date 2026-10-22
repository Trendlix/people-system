import type { Metadata } from 'next';
import { Suspense } from 'react';
import { vacancyEditable } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../../organization/ui';
import { updateVacancy } from '../../../actions';
import { loadVacancy, recruitmentNotLoaded } from '../../../data';
import { vacancyOptions } from '../../../pickers';
import { managesRecruitment, vacancyHref } from '../../../recruitment';
import { VacancyForm } from '../../../vacancy-form';

// Changing a vacancy (owner, 22 October 2026: "where will we include the ATS?"): everything while a draft; once published,
// all but its job title and employment type, and its questions only until someone has applied. Not while it waits for
// the CEO, nor once closed or filled.

export const metadata: Metadata = { title: 'Edit Vacancy · People System' };

async function EditVacancy({ params }: { params: PageProps<'/recruitment/vacancies/[id]/edit'>['params'] }) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!managesRecruitment(user)) return <Empty>Only HR (or a Super Admin) changes vacancies.</Empty>;
  const [loaded, options] = await Promise.all([loadVacancy(id), vacancyOptions()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'vacancy')}</Empty>;
  const v = loaded.value;
  const header = (
    <div className="space-y-2">
      <BackLink href={vacancyHref(v.id)}>{v.title}</BackLink>
      <h1 className="text-2xl font-semibold">Edit Vacancy</h1>
    </div>
  );
  if (!v.can.edit) {
    return (
      <>
        {header}
        <Empty>{v.status === 'pending' ? 'The vacancy is waiting for the CEO: ask them to send it back to change it.' : 'This vacancy can no longer be changed.'}</Empty>
      </>
    );
  }
  return (
    <>
      {header}
      <VacancyForm
        action={updateVacancy.bind(null, v.id, v.can.editQuestions)}
        defaults={{
          jobTitleId: v.jobTitle.id,
          title: v.title,
          gradeId: v.grade?.id ?? '',
          hiringManagerId: v.hiringManager?.id ?? '',
          headcount: v.headcount,
          employmentType: v.employmentType,
          workArrangement: v.workArrangement,
          shiftId: v.shift?.id ?? '',
          durationMonths: v.durationMonths,
          closingDate: v.closingDate,
          salaryMin: v.salaryMin,
          salaryMax: v.salaryMax,
          about: v.about ?? '',
          responsibilities: v.responsibilities ?? '',
          requirements: v.requirements ?? '',
          questions: v.questions,
          keySkills: v.keySkills,
        }}
        options={options}
        published={vacancyEditable(v.status) === 'published'}
        withQuestions={v.can.editQuestions}
        cancelHref={vacancyHref(v.id)}
        submitLabel="Save"
      />
    </>
  );
}

export default function EditVacancyPage({ params }: PageProps<'/recruitment/vacancies/[id]/edit'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditVacancy params={params} />
      </Suspense>
    </div>
  );
}
