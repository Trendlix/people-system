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
        HR imports the attendance from Zoho People. <Link href={ATTENDANCE_IMPORTS_PATH}>Import History</Link> lists every import.
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
        <div>
          <h1 className="text-2xl font-semibold">Import Attendance from Zoho People</h1>
          <p className="mt-1 max-w-3xl text-muted">
            The month&apos;s check-ins and check-outs from Zoho People, counted by the system&apos;s rules, not Zoho&apos;s: the hours within each
            person&apos;s shift (until its end plus the grace minutes), at most its hours a day; a working day without a check-in is an absent day;
            leave comes from the Leave module. Once read, the review opens on the month&apos;s payroll: confirm who each person is, then apply it to
            the payroll&apos;s figures, which can&apos;t be typed over afterwards. To change them, import the month again or undo the import on its
            review.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Import searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
