import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Shift } from '@/lib/types';
import { DAY_NAMES, Empty, Loading } from '../ui';

async function ShiftsList() {
  const [user, shifts] = await Promise.all([getCurrentUser(), apiGet<Shift[]>('/shifts')]);
  const canEdit = canEditOrganisation(user);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'}
        </p>
        {canEdit && (
          <Link href="/organisation/shifts/new" className="btn btn-primary">
            New shift
          </Link>
        )}
      </div>
      {shifts.length === 0 ? (
        <Empty>No shifts yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Hours</th>
                <th>Grace</th>
                <th>Working days</th>
                {canEdit && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">Shift {s.code}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatTime(s.startTime)} – {formatTime(s.endTime)}
                  </td>
                  <td className="whitespace-nowrap">{s.graceMinutes} min</td>
                  <td>{s.workingDays.map((d) => DAY_NAMES[d]).join(', ')}</td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organisation/shifts/${s.id}`}>Edit</Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function ShiftsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShiftsList />
    </Suspense>
  );
}
