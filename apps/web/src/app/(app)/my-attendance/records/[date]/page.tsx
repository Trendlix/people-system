import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isDay } from '@/lib/attendance-records';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../../../dashboard/cards';
import { Empty, Loading } from '../../../organization/ui';
import { myAttendanceHref } from '../../../attendance/attendance';
import { loadDayRecords } from '../../../attendance/records/load';
import { RecordsView } from '../../../attendance/records/records-view';

// One's own day's records, from My Attendance (owner, 31 October 2026: "is there a way to check the checkin records?"):
// each check-in and check-out kept, the system's and Zoho's, and which the day uses; read only (a Super Admin's own too
// may be put right here).

export const metadata: Metadata = { title: 'My attendance records · People System' };

async function MyRecords({ params }: { params: PageProps<'/my-attendance/records/[date]'>['params'] }) {
  const { date } = await params;
  if (!isDay(date)) notFound();
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const loaded = await loadDayRecords(user.employeeId, date);
  if (loaded.kind === 'missing') notFound();
  if (loaded.kind === 'failed') return <Empty>{loaded.message}</Empty>;
  return <RecordsView view={loaded.value} back={{ href: myAttendanceHref(date.slice(0, 7)), label: 'My Attendance' }} />;
}

export default function MyAttendanceRecordsPage({ params }: PageProps<'/my-attendance/records/[date]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <MyRecords params={params} />
    </Suspense>
  );
}
