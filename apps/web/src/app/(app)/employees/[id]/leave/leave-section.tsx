import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { adjustLeaveBalance } from '../../../leave/actions';
import { balanceYear, seesLeaveBalance, signedDays } from '../../../leave/balance';
import { loadEmployeeLeave, loadLeaveTypes } from '../../../leave/data';
import { AdjustBalanceForm } from '../../../leave/leave-forms';
import { recordLeaveHref, recordsLeave, requestsLabel } from '../../../leave/list';
import { LeaveBalanceFigures, MyLeaveTable } from '../../../leave/ui';
import { noLeaveText } from '../../employment-law';
import { ProfileSection, profileHref, todayInCairo } from '../../ui';

// The leave on the Employment tab's Details (owner, 18 October 2026: "can you apply the leaves according to the law?"),
// for HR, the CEO, Finance, the employee and their direct manager (the API decides; anyone else sees nothing here): the
// annual balance of a year (?leaveYear=, this year to start with) and what is left of the other types, HR's adjustments
// with their reasons, and the requests of the year. HR adjusts the balance (more days or fewer, with a reason) and
// records leave on the employee's behalf. A freelance employment has no leave (18 October 2026: outside the labour law),
// nor an intern's (19 October 2026: the unpaid internship, outside the law too), so it says so, and no leave is recorded
// for it.

const YEAR_LINK = 'inline-flex min-h-9 items-center text-sm font-semibold';

export async function LeaveSection({ employee: p, user, year: asked }: { employee: EmployeeProfile; user: SessionUser; year: string }) {
  const today = todayInCairo();
  const year = balanceYear(asked, today);
  const manages = !!user.employeeId && p.employment?.managerId === user.employeeId;
  if (!seesLeaveBalance(user, p, manages)) return null;
  const [leave, types] = await Promise.all([loadEmployeeLeave(p.id, year), loadLeaveTypes()]);
  if (leave.kind === 'unavailable' || leave.kind === 'forbidden') return null;
  const hr = recordsLeave(user);
  const now = Number(today.slice(0, 4));
  // outside the labour law: a freelancer's or an intern's employment has no leave
  const noLeave = p.employment ? noLeaveText(p.employment.employmentType) : null;
  const yearHref = (y: number) => `${profileHref(p.id, 'employment')}&leaveYear=${y}#leave`;

  return (
    <ProfileSection
      title={`Leave in ${year}`}
      note="Annual leave by Labour Law Art. 124; each year from January to December"
      actions={
        <>
          <Link href={yearHref(year - 1)} className={YEAR_LINK}>
            ← {year - 1}
          </Link>
          {year < now + 1 && (
            <Link href={yearHref(year + 1)} className={YEAR_LINK}>
              {year + 1} →
            </Link>
          )}
          {hr && p.employment && !noLeave && (
            <Link href={recordLeaveHref(p.id)} className="btn btn-secondary min-h-9 px-3">
              Record leave
            </Link>
          )}
        </>
      }
    >
      {leave.kind === 'failed' ? (
        <p className="card px-6 py-4 text-sm text-muted">The leave couldn&apos;t be loaded. {leave.messages.join(' ')}</p>
      ) : (
        <div className="space-y-4">
          {noLeave && <p className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">{noLeave}</p>}
          <div className="card space-y-4 p-5">
            <LeaveBalanceFigures balances={leave.value} types={types.kind === 'ok' ? types.value : null} />
            {(leave.value.adjustments?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Adjustments by HR</h3>
                <ul className="mt-1 divide-y divide-line-soft text-sm">
                  {leave.value.adjustments!.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                      <span>
                        <span className="font-semibold tabular-nums">{signedDays(a.days)}</span> · {a.reason}
                      </span>
                      <span className="text-xs text-muted">
                        {a.by && `${a.by} · `}
                        {formatDateTime(a.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* never HR's own: someone else in HR adjusts it (the API's rule) */}
            {hr && user.employeeId !== p.id && <AdjustBalanceForm action={adjustLeaveBalance.bind(null, p.id, year)} year={year} name={p.fullNameEn} />}
          </div>
          {leave.value.requests.length > 0 ? (
            <div className="card">
              <MyLeaveTable requests={leave.value.requests} />
              <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(leave.value.requests.length)} in {year}, newest first.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">No leave requests in {year}.</p>
          )}
        </div>
      )}
    </ProfileSection>
  );
}
