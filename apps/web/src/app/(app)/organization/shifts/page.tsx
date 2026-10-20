import Link from 'next/link';
import { Suspense } from 'react';
import { isFlexibleShift } from '@trendlix/shared';
import { apiGet } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { hoursADayText } from '@/lib/shifts';
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
          <Link href="/organization/shifts/new" className="btn btn-primary">
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
                <th>Hours to Work</th>
                <th>Count Hours Until</th>
                <th>Grace</th>
                <th>Working Days</th>
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
                  <td className="whitespace-nowrap tabular-nums">
                    {hoursADayText(s)}
                    {/* fewer hours than the window: worked anywhere within it (owner, 16 October 2026) */}
                    {isFlexibleShift(s) && <span className="badge ml-2">Flexible</span>}
                  </td>
                  {/* a long day fills the month's short hours (owner, 20 October 2026); none: the end and the grace */}
                  <td className="whitespace-nowrap tabular-nums">{s.countUntil ? formatTime(s.countUntil) : <span className="text-muted">End and grace</span>}</td>
                  <td className="whitespace-nowrap">{s.graceMinutes} min</td>
                  <td>{s.workingDays.map((d) => DAY_NAMES[d]).join(', ')}</td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organization/shifts/${s.id}`}>Edit</Link>
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
