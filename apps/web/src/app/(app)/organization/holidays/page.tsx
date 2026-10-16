import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { seesPayrollSettings } from '../payroll/settings';
import { Empty, Loading } from '../ui';
import { holidaysYear } from './holidays';
import { HolidaysTab } from './holidays-section';

// Organization → Holidays (owner, 16 October 2026: "make holiday a separate tab"; it was the third section of Payroll
// Setup): the year's official holidays, and under them each shift's working days in each month less the holidays, the
// hours a run expects of someone on that shift. HR, Finance, the CEO and Admin see it, as the payroll setup; HR and
// Admin add and change holidays; a Super Admin removes one (the API checks every request again). The year is in the
// address (?year=2027), this year to start with.

export const metadata: Metadata = { title: 'Holidays · People System' };

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/holidays'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!seesPayrollSettings(user)) return <Empty>Only HR, Finance, the CEO and Admin can see the holidays.</Empty>;
  const year = holidaysYear((await searchParams).year, todayInCairo());
  return <HolidaysTab user={user} year={year} />;
}

export default function HolidaysPage({ searchParams }: PageProps<'/organization/holidays'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
