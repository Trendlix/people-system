import { Suspense } from 'react';
import { createGrade } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { GradeForm } from '../grade-form';

export default function NewGradePage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/grades">Grades</BackLink>
      <h2 className="text-lg font-semibold">New Grade</h2>
      <Suspense fallback={<Loading />}>
        <RequireEditor>
          <GradeForm action={createGrade} />
        </RequireEditor>
      </Suspense>
    </div>
  );
}
