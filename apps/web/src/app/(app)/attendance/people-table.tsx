'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { GroupHeading } from '@/components/group-heading';
import type { AttendancePersonMonth } from '@/lib/attendance-types';
import { cLevelTitle } from '@/lib/confidential';
import type { DepartmentGroup } from '@/lib/place-groups';
import { filledText, hoursText, personHref } from './attendance';
import { DaysTable } from './ui';
import { joinShown } from '@/lib/hidden';

// A month's people, one row each with the month's figures, grouped by department, then team, in Organization's order
// (owner's brief, 19 October 2026: Daily Attendance), each opening to their days in place (Days); for a manager their
// team's (My Team → Team Attendance). Read only: the days are as the imports kept them. The C-level people the user
// doesn't see are one row at the end (`hidden`). Checking in on the system (owner, 19 October 2026: "Check-in through the
// system (phone or web with the office location check, or a device) to replace Zoho"): the check-outs without a
// check-in under the missing check-outs, and the days whose check-in was flagged for the manager and HR. Each day's
// check-in and check-out with its place and, for HR and the CEO, a Map link to where it was pressed (owner, 20 October
// 2026: "location link"; a manager gets the place only: the API leaves the spot out). A day worked from home (owner, 21
// October 2026: "think about how should we handle the working from home in out erp") says so, and the month's are
// counted under the remote days.

const COLUMNS = 11;

/** Where a name opens: the person's month (HR, the CEO, Finance), their profile (a manager's team), or nowhere. */
export type PersonLink = 'attendance' | 'profile' | null;

export function PeopleTable({ groups, month, link, hidden }: { groups: DepartmentGroup<AttendancePersonMonth>[]; month: string; link: PersonLink; hidden: string | null }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const several = groups.length > 1 || groups.some((g) => g.department !== null);
  const heading = (rows: AttendancePersonMonth[]) => ({ count: rows.length, note: `${rows.reduce((n, p) => n + p.figures.absentDays, 0)} absent days` });
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col" className="text-right">
              Days Worked
            </th>
            <th scope="col" className="text-right">
              Hours Counted
            </th>
            <th scope="col" className="text-right">
              Absent Days
            </th>
            <th scope="col" className="text-right">
              Short Hours
            </th>
            <th scope="col" className="text-right">
              Permission
            </th>
            <th scope="col" className="text-right">
              Remote Days
            </th>
            <th scope="col" className="text-right">
              Leave Days
            </th>
            <th scope="col" className="text-right">
              Missing Check-outs
            </th>
            <th scope="col" className="text-right">
              Flagged Days
            </th>
            <th scope="col">
              <span className="sr-only">Days</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.department ?? ''}>
              {several && <GroupHeading level="department" name={g.department} span={COLUMNS} {...heading(g.teams.flatMap((t) => t.rows))} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} span={COLUMNS} {...heading(t.rows)} />}
                  {t.rows.map((p) => {
                    const id = p.employee.id;
                    const f = p.figures;
                    const shown = open.has(id);
                    const name = p.employee.fullNameEn;
                    const href = link === 'attendance' ? personHref(id, month) : link === 'profile' ? `/employees/${id}` : null;
                    return (
                      <Fragment key={id}>
                        <tr className="align-top">
                          <td className="min-w-48">
                            {href ? (
                              <Link href={href} className="font-semibold">
                                {name}
                              </Link>
                            ) : (
                              <span className="font-semibold">{name}</span>
                            )}
                            {p.employee.confidential && <CLevelBadge title={cLevelTitle(false)} className="ml-2" />}
                            <div className="text-xs text-muted">{joinShown([p.employee.employeeCode, p.employee.jobTitle])}</div>
                          </td>
                          <td className="text-right tabular-nums">
                            {f.daysWorked}
                            <div className="text-xs text-muted">{f.officeDays} office</div>
                          </td>
                          <td className="text-right tabular-nums">
                            {hoursText(f.hoursCounted)}
                            {p.averageHours !== null && <div className="text-xs text-muted">{hoursText(p.averageHours)} a day</div>}
                          </td>
                          <td className={`text-right tabular-nums ${f.absentDays ? 'font-semibold text-danger' : ''}`}>{f.absentDays}</td>
                          <td className={`text-right tabular-nums ${f.shortHours ? 'font-semibold text-warn' : ''}`}>
                            {hoursText(f.shortHours, true)}
                            {/* make-up hours (owner, 20 October 2026): the short hours the month's extra time filled */}
                            {filledText(f) && <div className="text-xs font-normal whitespace-nowrap text-ok">{filledText(f)}</div>}
                          </td>
                          <td className="text-right tabular-nums">{hoursText(f.permissionHours, true)}</td>
                          <td className="text-right tabular-nums">
                            {f.remoteDays}
                            {(p.wfhDays?.length ?? 0) > 0 && <div className="text-xs whitespace-nowrap text-muted">{p.wfhDays!.length} working from home</div>}
                            {/* the month's official duty days (23 October 2026) */}
                            {(p.odDays?.length ?? 0) > 0 && <div className="text-xs whitespace-nowrap text-ok">{p.odDays!.length} on official duty</div>}
                          </td>
                          <td className="text-right tabular-nums">
                            {f.leaveDays}
                            {f.zohoLeaveDays > 0 && <div className="text-xs text-warn">+{f.zohoLeaveDays} in Zoho only</div>}
                          </td>
                          <td className={`text-right tabular-nums ${f.missingCheckOuts ? 'font-semibold text-warn' : ''}`}>
                            {f.missingCheckOuts}
                            {(f.missingCheckIns ?? 0) > 0 && (
                              <div className="text-xs font-normal whitespace-nowrap text-warn">
                                +{f.missingCheckIns} {f.missingCheckIns === 1 ? 'check-in' : 'check-ins'} missing
                              </div>
                            )}
                          </td>
                          <td className={`text-right tabular-nums ${f.flaggedDays ? 'font-semibold text-warn' : ''}`}>{f.flaggedDays ?? 0}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() => toggle(id)}
                              aria-expanded={shown}
                              aria-controls={`attendance-days-${id}`}
                              className="btn btn-secondary min-h-9 px-3 whitespace-nowrap"
                            >
                              {shown ? 'Hide days' : 'Days'}
                              <span className="sr-only"> of {name}</span>
                            </button>
                          </td>
                        </tr>
                        {shown && (
                          <tr id={`attendance-days-${id}`}>
                            <td colSpan={COLUMNS} className="bg-canvas px-2 py-3">
                              {p.days.length ? <DaysTable days={p.days} name={name} punches={p.punches ?? []} wfhDays={p.wfhDays ?? []} /> : <p className="px-2 text-sm text-muted">No days kept.</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </Fragment>
          ))}
          {hidden && (
            <tr>
              <td colSpan={COLUMNS} className="text-sm font-semibold text-muted">
                {hidden}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
