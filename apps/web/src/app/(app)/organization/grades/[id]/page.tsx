import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import type { Grade } from '@/lib/types';
import { deleteGrade, updateGrade } from '../../actions';
import { BackLink, Loading, RequireEditor, UUID } from '../../ui';
import { GradeForm } from '../grade-form';
import { gradeLabel } from '../label';

async function EditGrade({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const grade = await apiGet<Grade>(`/grades/${id}`);
  const used = grade._count.jobTitles;
  return (
    <RequireEditor>
      <h2 className="text-lg font-semibold">Grade {gradeLabel(grade)}</h2>
      <div className="mt-4 space-y-8">
        <GradeForm action={updateGrade.bind(null, id)} grade={grade} />
        <section className="max-w-xl space-y-2">
          <h3 className="font-semibold">Delete Grade</h3>
          {used > 0 ? (
            <p className="text-sm text-muted">
              {used} {used === 1 ? 'job title has' : 'job titles have'} this grade. Give {used === 1 ? 'it' : 'them'} another grade first.
            </p>
          ) : (
            <DeleteForm
              action={deleteGrade.bind(null, id)}
              confirmText={`Delete grade ${gradeLabel(grade)}? This cannot be undone.`}
              label="Delete grade"
            />
          )}
        </section>
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
