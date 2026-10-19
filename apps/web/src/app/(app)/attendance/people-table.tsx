'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { GroupHeading } from '@/components/group-heading';
import type { AttendancePersonMonth } from '@/lib/attendance-types';
import { cLevelTitle } from '@/lib/confidential';
import type { DepartmentGroup } from '@/lib/place-groups';
import { hoursText, personHref } from './attendance';
import { DaysTable } from './ui';

// A month's people, one row each with the month's figures, grouped by department, then team, in Organization's order
// (owner's brief, 19 October 2026: Daily Attendance), each opening to their days in place (Days); for a manager their
// team's (My Team → Team Attendance). Read only: the days are as the imports kept them. The C-level people the user
// doesn't see are one row at the end (`hidden`).

const COLUMNS = 10;

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
                            <div className="text-xs text-muted">
                              {p.employee.employeeCode}
                              {p.employee.jobTitle && ` · ${p.employee.jobTitle}`}
                            </div>
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
                          <td className={`text-right tabular-nums ${f.shortHours ? 'font-semibold text-warn' : ''}`}>{hoursText(f.shortHours, true)}</td>
                          <td className="text-right tabular-nums">{hoursText(f.permissionHours, true)}</td>
                          <td className="text-right tabular-nums">{f.remoteDays}</td>
                          <td className="text-right tabular-nums">
                            {f.leaveDays}
                            {f.zohoLeaveDays > 0 && <div className="text-xs text-warn">+{f.zohoLeaveDays} in Zoho only</div>}
                          </td>
                          <td className={`text-right tabular-nums ${f.missingCheckOuts ? 'font-semibold text-warn' : ''}`}>{f.missingCheckOuts}</td>
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
                              {p.days.length ? <DaysTable days={p.days} name={name} /> : <p className="px-2 text-sm text-muted">No days kept.</p>}
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
