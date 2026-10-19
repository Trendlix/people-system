import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { marksConfidentialGrade } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Grade } from '@/lib/types';
import { deleteGrade, updateGrade } from '../../actions';
import { BackLink, Loading, RequireEditor, UUID } from '../../ui';
import { GradeForm } from '../grade-form';
import { CONFIDENTIAL_GRADE_HINT, gradeLabel } from '../label';

async function EditGrade({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [user, grade] = await Promise.all([getCurrentUser(), apiGet<Grade>(`/grades/${id}`)]);
  // A grade a job title's range starts or ends at, or that an employment has, stays (the API refuses too).
  const { jobTitles, employments } = grade._count;
  const uses = [
    jobTitles === 1 && '1 job title takes it as its lowest or highest grade',
    jobTitles > 1 && `${jobTitles} job titles take it as their lowest or highest grade`,
    employments > 0 && `${employments} ${employments === 1 ? 'employment has' : 'employments have'} it (ended ones included)`,
  ].filter(Boolean);
  return (
    <RequireEditor>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Grade {gradeLabel(grade)}</h2>
        {grade.confidential && <CLevelBadge title={CONFIDENTIAL_GRADE_HINT} />}
      </div>
      <div className="mt-4 space-y-8">
        {/* the C-level tick, a Super Admin's only (owner, 19 October 2026) */}
        <GradeForm action={updateGrade.bind(null, id)} grade={grade} marksConfidential={marksConfidentialGrade(user)} />
        {/* only a Super Admin deletes (owner's decision, 15 October 2026) */}
        {canDelete(user) && (
          <section className="max-w-xl space-y-2">
            <h3 className="font-semibold">Delete Grade</h3>
            {uses.length > 0 ? (
              <p className="text-sm text-muted">
                {grade.code} is in use: {uses.join(', and ')}. Change {jobTitles + employments === 1 ? 'it' : 'them'} first.
              </p>
            ) : (
              <DeleteForm
                action={deleteGrade.bind(null, id)}
                confirmText={`Delete grade ${gradeLabel(grade)}? This cannot be undone.`}
                label="Delete grade"
              />
            )}
          </section>
        )}
      </div>
    </RequireEditor>
  );
}

export default function GradePage({ params }: PageProps<'/organization/grades/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/grades">Grades</BackLink>
      <Suspense fallback={<Loading />}>
        <EditGrade params={params} />
      </Suspense>
    </div>
  );
}
