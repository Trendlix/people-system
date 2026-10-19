import { Suspense } from 'react';
import { marksConfidentialGrade } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { createGrade } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { GradeForm } from '../grade-form';

/** The form, with the C-level tick for a Super Admin (owner, 19 October 2026). */
async function NewGrade() {
  const user = await getCurrentUser();
  return <GradeForm action={createGrade} marksConfidential={marksConfidentialGrade(user)} />;
}

export default function NewGradePage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/grades">Grades</BackLink>
      <h2 className="text-lg font-semibold">New Grade</h2>
      <Suspense fallback={<Loading />}>
        <RequireEditor>
          <NewGrade />
        </RequireEditor>
      </Suspense>
    </div>
  );
}
