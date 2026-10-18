import Link from 'next/link';
import { Fragment } from 'react';
import { GroupHeading } from '@/components/group-heading';
import { formatDate } from '@/lib/format';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import { calendarAgenda, monthTitle, nextMonth, offPerDay, offThisMonthText, previousMonth, typeLetters, type CalendarDay, type CalendarPerson } from './calendar';
import { CalendarDepartmentFilter, type DepartmentChoice } from './calendar-filter';
import { daysNumber, leaveHref } from './list';

// The month's calendar of who is off (owner, 18 October 2026, leaves first: "if we will work on the attendance and
// leaves, how will we build it?"): on a wide screen a grid, a row for each person off in the month, grouped by
// department, then team, a column for each day with its weekday and the official holidays shaded, each day off marked
// with its type's letter (half a day half filled; one still being decided outlined), and how many are off each day; on a
// phone the same month as a list of its days, each with who is off and the holidays. The month and the department are
// in the address, so a link keeps them.

const LINK = 'btn btn-secondary min-h-9 px-3 no-underline';

/** A day's leave in the grid: its type's letter, filled when approved, outlined while it is being decided. */
function Cell({ cell, letter, name, day }: { cell: NonNullable<CalendarPerson['cells'][number]>; letter: string; name: string; day: CalendarDay }) {
  const label = `${name}: ${cell.typeName}${cell.halfDay ? ', half a day' : ''}${cell.waiting ? ', being decided' : ''}, ${day.weekdayName} ${formatDate(day.date)}`;
  const look = cell.waiting ? 'border border-dashed border-warn bg-warn-soft text-warn' : 'bg-accent text-white';
  const shape = `${cell.first ? 'rounded-l-md' : ''} ${cell.last ? 'rounded-r-md' : ''}`;
  const body = (
    <span
      title={label}
      className={`relative flex h-7 items-center justify-center overflow-hidden text-[11px] font-semibold ${look} ${shape}`}
    >
      {cell.halfDay && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1/2 bg-card/70" />}
      <span className="relative">{letter}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
  return cell.requestId ? (
    <Link href={leaveHref(cell.requestId)} prefetch={false} className="block no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

/** The grid: the people off in the month, by department and team, a column a day. */
function MonthGrid({ days, people, letters }: { days: CalendarDay[]; people: CalendarPerson[]; letters: Map<string, string> }) {
  const groups = groupByPlace(people, (p) => p.place);
  const off = offPerDay(people, days.length);
  const span = days.length + 2;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Who is off on each day of the month</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-44 border-b border-line bg-card px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
              Employee
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                scope="col"
                title={d.holidays.map((h) => h.nameEn).join(', ') || undefined}
                className={`min-w-7 border-b border-line px-0 py-1 text-center text-[11px] font-medium ${d.holidays.length ? 'bg-warn-soft text-warn' : 'text-muted'} ${d.today ? 'text-accent' : ''}`}
              >
                <span className="block font-semibold tabular-nums">{d.day}</span>
                <span className="block">{d.weekday.slice(0, 2)}</span>
                <span className="sr-only">
                  {d.weekdayName}
                  {d.holidays.length ? `, ${d.holidays.map((h) => h.nameEn).join(', ')}` : ''}
                </span>
              </th>
            ))}
            <th scope="col" className="border-b border-line px-3 py-2 text-right text-xs font-semibold tracking-wide text-muted uppercase">
              Days
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.department ?? ''}>
            {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={span} />}
            {g.teams.map((t) => (
              <Fragment key={t.team ?? ''}>
                {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={span} />}
                {t.rows.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-line-soft bg-card px-3 py-1.5 text-left font-medium">
                      <Link href={`/employees/${p.id}`} prefetch={false} className="font-medium">
                        {p.name}
                      </Link>
                    </th>
                    {p.cells.map((c, i) => (
                      <td key={days[i].date} className={`border-b border-line-soft px-0 py-1.5 ${days[i].holidays.length ? 'bg-warn-soft/50' : ''} ${days[i].today ? 'bg-accent-soft/50' : ''}`}>
                        {c && <Cell cell={c} letter={letters.get(c.typeName) ?? '•'} name={p.name} day={days[i]} />}
                      </td>
                    ))}
                    <td className="border-b border-line-soft px-3 py-1.5 text-right tabular-nums">{daysNumber(p.daysOff)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
              Off
            </th>
            {off.map((n, i) => (
              <td key={days[i].date} className="px-0 py-2 text-center text-[11px] text-muted tabular-nums">
                {n ? daysNumber(n) : ''}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The month as a list of its days, for a phone: each day someone is off or a holiday falls on. */
function MonthAgenda({ days, people }: { days: CalendarDay[]; people: CalendarPerson[] }) {
  const agenda = calendarAgenda(people, days);
  if (!agenda.length) return null;
  return (
    <ol className="card divide-y divide-line-soft" aria-label="The days of the month someone is off">
      {agenda.map(({ day, off }) => (
        <li key={day.date} className="space-y-1.5 px-4 py-3">
          <p className={`text-sm font-semibold ${day.today ? 'text-accent' : ''}`}>
            {day.weekdayName} {formatDate(day.date)}
            {day.today && <span className="badge ml-2">Today</span>}
          </p>
          {day.holidays.map((h) => (
            <p key={h.nameEn} className="text-xs font-medium text-warn">
              Official holiday: {h.nameEn}
            </p>
          ))}
          {off.length > 0 && (
            <ul className="space-y-1">
              {off.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="min-w-0">
                    {o.requestId ? (
                      <Link href={leaveHref(o.requestId)} prefetch={false} className="font-medium">
                        {o.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{o.name}</span>
                    )}
                    {o.place && <span className="block text-xs text-muted">{o.place}</span>}
                  </span>
                  <span className={`text-xs ${o.waiting ? 'text-warn' : 'text-muted'}`}>
                    {o.typeName}
                    {o.halfDay && ', half a day'}
                    {o.waiting && ', being decided'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The calendar of a month: the month and the arrows to the one before and after, the department chosen (for those who
 * see more than their team), the grid (the list on a phone), the legend and the month's holidays. `hrefFor`: the
 * address of a month with the same department; `showsWaiting`: those still being decided are among them (HR's).
 */
export function LeaveCalendar({
  month,
  days,
  people,
  hrefFor,
  departments,
  departmentId,
  showsWaiting,
  filterAction,
  hidden,
}: {
  month: string;
  days: CalendarDay[];
  people: CalendarPerson[];
  hrefFor: (month: string) => string;
  /** The departments and teams to choose from; null: no filter (a manager's own team). */
  departments: DepartmentChoice[] | null;
  departmentId: string | null;
  showsWaiting: boolean;
  /** Where the department filter's form goes, and what it keeps (the view and the month). */
  filterAction: string;
  hidden: Record<string, string>;
}) {
  const letters = typeLetters(people.flatMap((p) => p.cells.flatMap((c) => (c ? [c.typeName] : []))));
  const holidays = days.filter((d) => d.holidays.length);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Month" className="flex flex-wrap items-center gap-2">
          <Link href={hrefFor(previousMonth(month))} className={LINK}>
            ← <span className="sr-only">{monthTitle(previousMonth(month))}</span>
            <span aria-hidden="true">{monthTitle(previousMonth(month)).slice(0, 3)}</span>
          </Link>
          <h2 aria-current="page" className="px-2 text-lg font-semibold tabular-nums">
            {monthTitle(month)}
          </h2>
          <Link href={hrefFor(nextMonth(month))} className={LINK}>
            <span aria-hidden="true">{monthTitle(nextMonth(month)).slice(0, 3)}</span>
            <span className="sr-only">{monthTitle(nextMonth(month))}</span> →
          </Link>
        </nav>
        {departments && <CalendarDepartmentFilter action={filterAction} hidden={hidden} departments={departments} chosen={departmentId} />}
      </div>

      <p className="text-sm text-muted">
        {offThisMonthText(people.length)}
        {showsWaiting && ', approved and still being decided'}.
      </p>

      {people.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">No one has leave in {monthTitle(month)}{departmentId ? ' in this department' : ''}.</div>
      ) : (
        <>
          <div className="hidden md:block">
            <MonthGrid days={days} people={people} letters={letters} />
          </div>
          <div className="md:hidden">
            <MonthAgenda days={days} people={people} />
          </div>
        </>
      )}

      {people.length > 0 && (
        <ul aria-label="What the marks mean" className="hidden flex-wrap gap-x-5 gap-y-2 text-xs text-muted md:flex">
          {[...letters.entries()].map(([name, letter]) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded bg-accent text-[11px] font-semibold text-white">{letter}</span>
              {name}
            </li>
          ))}
          {showsWaiting && (
            <li className="flex items-center gap-1.5">
              <span className="size-5 rounded border border-dashed border-warn bg-warn-soft" /> Being decided
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span className="relative size-5 overflow-hidden rounded bg-accent">
              <span className="absolute inset-x-0 top-0 h-1/2 bg-card/70" />
            </span>{' '}
            Half a day
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-5 rounded bg-warn-soft" /> Official holiday
          </li>
        </ul>
      )}

      {holidays.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Official Holidays in {monthTitle(month)}</h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {holidays.map((d) => (
              <li key={d.date}>
                <span className="tabular-nums">
                  {d.weekdayName} {formatDate(d.date)}
                </span>
                : {d.holidays.map((h) => h.nameEn).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
