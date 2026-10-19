import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { loadRun } from '../../data';
import { canSeePayroll, preparesPayroll, runHref, runTitle } from '../../list';
import { notLoadedText } from '../../load';
import { uploadAttendance } from './actions';
import { loadImports } from './data';
import { ImportsList } from './imports-list';
import { UploadAttendanceForm } from './upload-form';

// Import attendance from Zoho People (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now,
// replace it later"), on a draft run: HR uploads Zoho's attendance entries, one file with everyone or a file per person
// ("Accept one file with everyone, or many files at once"), and their review opens; nothing changes on the run until it
// is applied there. The run's earlier imports are listed under the form, each opening its review (the CEO's way to the
// C-level people's lines too). The API checks the role and the run again.

export const metadata: Metadata = { title: 'Import Attendance · People System' };

async function ImportAttendance({ params }: { params: PageProps<'/payroll/[id]/attendance'>['params'] }) {
  const user = await getCurrentUser();
  if (!canSeePayroll(user)) return <Empty>Only HR, Finance and the CEO can see payroll.</Empty>;
  const run = await loadRun(params);
  if (!run) return <Empty>Not available yet: the server does not have payroll yet.</Empty>;
  const imports = await loadImports(run.id);
  const title = runTitle(run.month);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={runHref(run.id)}>{title}</BackLink>
        <h1 className="text-2xl font-semibold">Import Attendance from Zoho People</h1>
        <p className="max-w-3xl text-muted">
          The month&apos;s check-ins and check-outs from Zoho People, for {title}. Each day is counted by the system&apos;s rules, not Zoho&apos;s: the
          hours within the employee&apos;s shift, at most its hours a day; a working day without a check-in is an absent day (the run&apos;s no-show
          days); leave comes from the Leave module, and a day Zoho marks as leave without leave in the system is listed for you to record; the
          permission hours are the requests approved in the system, else Zoho&apos;s, within the month&apos;s allowance. Each check-in is kept as at
          the office or remote, never its address.
        </p>
      </div>
      {run.status !== 'draft' ? (
        <Empty>This payroll isn&apos;t a draft any more, so attendance can&apos;t be imported on it.</Empty>
      ) : preparesPayroll(user) ? (
        <section aria-labelledby="upload-heading" className="card space-y-3 p-6">
          <h2 id="upload-heading" className="font-semibold">
            Upload the Files
          </h2>
          <UploadAttendanceForm action={uploadAttendance.bind(null, run.id)} />
        </section>
      ) : (
        <Empty>HR uploads the attendance files. Open an import below to review it.</Empty>
      )}
      <section aria-labelledby="imports-heading" className="space-y-3">
        <h2 id="imports-heading" className="text-lg font-semibold">
          Imports on This Payroll
        </h2>
        {imports.kind === 'ok' ? (
          imports.value.length ? (
            <ImportsList runId={run.id} imports={imports.value} />
          ) : (
            <p className="text-sm text-muted">None yet.</p>
          )
        ) : (
          <p className="text-sm text-muted">{notLoadedText(imports, 'imports')}</p>
        )}
      </section>
    </div>
  );
}

export default function ImportAttendancePage({ params }: PageProps<'/payroll/[id]/attendance'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <ImportAttendance params={params} />
      </Suspense>
    </div>
  );
}
