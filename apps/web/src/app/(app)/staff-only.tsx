import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError } from '@/lib/api';
import { isSelfService } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { Loading } from './organization/ui';

// Pages that aren't an employee's (owner, 17 October 2026: "dont show him the organization tab"): the Organization
// pages and the Employees lists send someone who is only an employee and/or a direct manager to their dashboard, as
// their sidebar no longer has them. Their own profile, and a manager's direct reports' profiles, are under /employees/<id>
// and stay theirs. What they may read is still the API's to decide; this only keeps the pages out of their way.

async function Gate({ children }: { children: React.ReactNode }) {
  try {
    if (isSelfService(await getCurrentUser())) redirect('/');
  } catch (err) {
    // like the sidebar: who it is can't be read (the API is down), so the page says what it can
    if (!(err instanceof ApiError)) throw err;
  }
  return children;
}

/** The children for HR, Finance, the CEO and Admins (a Super Admin too); an employee or a manager goes to the dashboard. */
export function StaffOnly({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
