import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Loading } from '../organization/ui';
import { MY_HIRING_PATH } from './hiring';
import { readsRecruitment, VACANCIES_PATH } from './recruitment';

// Recruitment (owner, 22 October 2026: "where will we include the ATS?"): its first page is the vacancies for HR, the CEO
// and a Super Admin; My Hiring for a hiring manager or an interviewer (Phase 2).

async function Gate(): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  redirect(readsRecruitment(user) ? VACANCIES_PATH : MY_HIRING_PATH);
}

export default function RecruitmentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
