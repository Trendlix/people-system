import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { canSeeLeaveReport, LEAVE_REPORT_PATH } from './leave-report';

// The Leave report's link on the Payroll Reports page (owner, 26 October 2026: "can i get a report for the monthly leaves
// with all types?"), beside the Salary Raises and Contracts links: only for those who may open it (HR and the CEO; the
// hub is HR's, Finance's and the CEO's).
export async function LeaveReportLink() {
  const user = await getCurrentUser();
  if (!canSeeLeaveReport(user)) return null;
  return (
    <>
      {' '}
      The month’s leave has one too: <Link href={LEAVE_REPORT_PATH}>Leave</Link>.
    </>
  );
}
