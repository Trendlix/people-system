import { formatHours } from '@trendlix/shared';
import Link from 'next/link';
import { formatTime } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { canEditOrganisation } from '@/lib/session';
import type { Holiday, SessionUser, Shift } from '@/lib/types';
import { DAY_NAMES } from '../ui';
import { addHoliday, deleteHoliday, updateHoliday } from './actions';
import { loadHolidays, loadShifts } from './data';
import { AddHolidayForm, EditableHoliday, HolidayText } from './holidays-forms';
import { NotLoaded, SetupSection } from './section';
import { HOLIDAY_YEARS, workingMonths } from './settings';

// Payroll Setup, 3 Holidays and Working Days (owner's request, 16 October 2026): the year's official holidays, and the
// working days they come out of. A run works out each monthly-paid person's expected hours from their shift
// (Organization → Shifts): its working days within the days they are employed in the month, less the holidays on those
// days, × its hours a day; HR can type over the figure on the run. Without a shift there is none, and pay by the hour
// isn't affected. HR and Admin add and change holidays; a Super Admin removes one; HR, Finance, the CEO and Admin read
// them. The year is in the address (?year=2027), this year to start with.

const INTRO =
  'The year’s official holidays. A holiday on a shift’s working day isn’t worked, so a run takes its hours out of the expected hours: each monthly-paid person is expected their shift’s working days in the days they are paid for, less the holidays on them, at the shift’s hours a day. HR can type over that figure on the run. Runs made or refreshed afterwards count a change; approved runs keep theirs. Pay by the hour isn’t affected.';

/** The holidays of the year before or after: this section of the page, for that year. */
const yearHref = (year: number) => `/organization/payroll?year=${year}#holidays`;

function YearNav({ year }: { year: number }) {
  return (
    <nav aria-label="Year" className="flex flex-wrap items-center gap-2">
      {year > HOLIDAY_YEARS.from && (
        <Link href={yearHref(year - 1)} className="btn btn-secondary min-h-9 px-3 no-underline">
          ← {year - 1}
        </Link>
      )}
      <span aria-current="page" className="px-2 text-lg font-semibold tabular-nums">
        {year}
      </span>
      {year < HOLIDAY_YEARS.to && (
        <Link href={yearHref(year + 1)} className="btn btn-secondary min-h-9 px-3 no-underline">
          {year + 1} →
        </Link>
      )}
    </nav>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each month of the year with each shift's working days, less the holidays, and the hours they come to. */
function WorkingDaysTable({ year, shifts, holidays }: { year: number; shifts: Shift[]; holidays: Holiday[] }) {
  const months = workingMonths(year, shifts, holidays);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            {shifts.map((s) => (
              <th key={s.id} scope="col" className="text-right">
                Shift {s.code}
                <span className="block text-xs font-normal whitespace-nowrap text-muted">
                  {s.workingDays.map((d) => DAY_NAMES[d]).join(', ')} · {formatTime(s.startTime)} – {formatTime(s.endTime)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="font-medium">
                {m.name}
              </th>
              {m.shifts.map((c) => (
                <td key={c.code} className="text-right whitespace-nowrap tabular-nums">
                  {c.hours === null ? <span className="text-muted">—</span> : formatHours(c.hours)}
                  <span className="block text-xs text-muted">
                    {plural(c.workingDays - c.holidays, 'day', 'days')}
                    {c.holidays > 0 && ` (${plural(c.holidays, 'holiday', 'holidays')} off)`}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function HolidaysSection({ user, year }: { user: SessionUser; year: number }) {
  const [holidays, shifts] = await Promise.all([loadHolidays(year), loadShifts()]);
  const canEdit = canEditOrganisation(user);
  const canRemove = canDelete(user);
  const list = holidays.kind === 'ok' ? holidays.value : [];

  return (
    <SetupSection id="holidays" title="Holidays and Working Days" intro={INTRO}>
      <div className="space-y-8">
        <YearNav year={year} />

        <div className="space-y-3">
          <h3 className="font-semibold">{`Official Holidays in ${year}`}</h3>
          {holidays.kind !== 'ok' ? (
            <NotLoaded what="the holidays" loaded={holidays} />
          ) : (
            <>
              {list.length === 0 ? (
                <p className="text-sm text-muted">No holidays in {year} yet.</p>
              ) : (
                <ul className="divide-y divide-line-soft rounded-lg border border-line">
                  {list.map((h) => (
                    <li key={h.id} className="px-4 py-3">
                      {canEdit ? (
                        <EditableHoliday holiday={h} action={updateHoliday.bind(null, h.id)} remove={canRemove ? deleteHoliday.bind(null, h.id) : null} />
                      ) : (
                        <HolidayText holiday={h} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && <AddHolidayForm action={addHoliday} />}
            </>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold">{`Working Days in ${year}`}</h3>
          <p className="max-w-3xl text-sm text-muted">
            Each shift&apos;s working days in each month, less the holidays on them, and the expected hours they come to for someone employed all month.
            Someone who joins or leaves in a month is expected the days they are employed.{' '}
            {canEdit && <Link href="/organization/shifts">Change the shifts</Link>}
          </p>
          {shifts.kind !== 'ok' ? (
            <NotLoaded what="the shifts" loaded={shifts} />
          ) : shifts.value.length === 0 ? (
            <p className="text-sm text-muted">No shifts yet: without a shift, a run has no expected hours to work out.</p>
          ) : (
            <WorkingDaysTable year={year} shifts={shifts.value} holidays={list} />
          )}
        </div>
      </div>
    </SetupSection>
  );
}
