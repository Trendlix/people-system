import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isDay } from '@/lib/attendance-records';
import { Empty, Loading, UUID } from '../../../../organization/ui';
import { personHref } from '../../../attendance';
import { loadDayRecords } from '../../../records/load';
import { RecordsView } from '../../../records/records-view';

// A person's day's records (owner, 31 October 2026: "is there a way to check the checkin records? even if imported from
// zoho and delete one of them?" — "as a super admin"), from their month's row: for those who see the month, and a Super
// Admin, who removes and puts back records and chooses the source (records-view.tsx).

export const metadata: Metadata = { title: 'Attendance records · People System' };

async function Records({ params }: { params: PageProps<'/attendance/[employeeId]/records/[date]'>['params'] }) {
  const { employeeId, date } = await params;
  if (!UUID.test(employeeId) || !isDay(date)) notFound();
  const loaded = await loadDayRecords(employeeId, date);
  if (loaded.kind === 'missing') notFound();
  if (loaded.kind === 'failed') return <Empty>{loaded.message}</Empty>;
  return <RecordsView view={loaded.value} back={{ href: personHref(employeeId, date.slice(0, 7)), label: `${loaded.value.employee.fullNameEn}’s month` }} />;
}

export default function AttendanceRecordsPage({ params }: PageProps<'/attendance/[employeeId]/records/[date]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Records params={params} />
    </Suspense>
  );
}
