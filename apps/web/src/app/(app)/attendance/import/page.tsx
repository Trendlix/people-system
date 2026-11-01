import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { importMonthChoices, importsAttendance, suggestedImportMonth } from '../attendance';
import { loadRuns } from '../data';
import { notLoaded } from '../not-loaded';
import { ATTENDANCE_IMPORTS_PATH } from '../sections';
import { importForMonth } from './actions';
import { ImportForm } from './import-form';

// Import (owner, 19 October 2026: "where am i going to import the sheets?"): from the Attendance section itself, HR picks
// the month and drops Zoho People's attendance entries here; they go into the month's draft payroll run (a draft is
// made first when the month has none, as Payroll's New run does) and their review opens there, as from the run's own
// Import attendance, which stays. A month whose payroll is with the CEO, approved or paid is locked: it is listed, not
// chosen, and the API refuses it too. HR only (the API's upload is HR's); the CEO and Finance are pointed to Import
// History.

export const metadata: Metadata = { title: 'Import Attendance · People System' };

async function Import({ searchParams }: { searchParams: PageProps<'/attendance/import'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!importsAttendance(user)) {
    return (
      <Empty>
        Only HR imports attendance. <Link href={ATTENDANCE_IMPORTS_PATH}>Import History</Link>
      </Empty>
    );
  }
  const query = await searchParams;
  const today = todayInCairo();
  const runs = await loadRuns();
  if (runs.kind !== 'ok') return <Empty>{notLoaded(runs, 'payroll months')}</Empty>;
  const months = importMonthChoices(
    today,
    runs.value.map((r) => ({ id: r.id, month: r.month, status: r.status })),
  );
  const suggested = suggestedImportMonth(months, today, typeof query.month === 'string' ? query.month : null);
  if (!suggested) return <Empty>Every month from a year back is locked: its payroll is with the CEO, approved or paid.</Empty>;
  return (
    <section aria-labelledby="import-heading" className="card space-y-3 p-6">
      <h2 id="import-heading" className="font-semibold">
        Upload the Files
      </h2>
      <ImportForm action={importForMonth} months={months} suggested={suggested} />
    </section>
  );
}

export default function ImportAttendancePage({ searchParams }: PageProps<'/attendance/import'>) {
  return (
    <StaffOnly>
      <div className="max-w-4xl space-y-6">
        <h1 className="page-title">Import Attendance from Zoho People</h1>
        <Suspense fallback={<Loading />}>
          <Import searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
