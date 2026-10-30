import Link from 'next/link';
import { cairoClock, clockText, HISTORY_MODE_LABELS, HISTORY_SOURCE_LABELS, percentText, type HistoryDay } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import type { AttendanceHistoryView } from '@/lib/attendance-history-types';
import { formatDate, formatDateTime } from '@/lib/format';
import type { EmployeeProfile } from '@/lib/types';
import { COMPENSATORY_DAY_TITLE, dayPairs, EXEMPT_DAY_TITLE, FIRST_DAY_BADGE, firstDayNote, hoursText } from '../../../attendance/attendance';
import { DayPairsLine, OpenPressLine } from '../../../attendance/ui';
import { Empty } from '../../../organization/ui';
import { loadJson } from '../../../payroll/load';
import { ColumnBarChart, TrendLineChart } from './history-charts';
import {
  binsChart,
  hasRehireGap,
  historyApiPath,
  historyExcelHref,
  historyFilterChoices,
  historyHref,
  historyMonthHref,
  historyTiles,
  HISTORY_PERIOD_CHOICES,
  lateText,
  logDateText,
  rangeText,
  trendCell,
  trendChart,
  weekdayChart,
  type HistoryQuery,
} from './history';

// The profile's Attendance tab (owner, 23 October 2026: "Attendance history on the profile. Since joining: on-time %,
// average check-in time, late days by weekday and trends; an Excel export"; asked who sees it, "HR, CEO and Finance
// only"): for HR, the CEO, Finance and the Super Admin (the page shows them the tab; a C-level person's the API keeps to
// the CEO and the Super Admin, and its 404 is said here, never a crash). The period in one row above everything it
// scopes (this month, the last 3 months, this year, since joining, or a custom range), the figures with what each means,
// the on-time trend (by month, by quarter past 12 months), the check-in times by 15 minutes and the late days by
// weekday, each chart with its table, then the daily log, latest first, filtered (late, WFH, OD, leave, absent) and
// paged by the server, an official duty's row linking to its request and a corrected one to its correction; the Excel
// of the whole period (never a developer's, the API refuses it) and the month page a click away. A day of several
// check-in → check-out pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
// only, not the first and last") lists them and its break under its hours, an open last check-in under its last out;
// an exempt day (owner, 25 October 2026: "trat them as if they achived their full working hours") is an "Exempt" badge.
// A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin
// to 9am automatically to prevent delay in instructions"): never late, so its Late cell says "First day" instead, with
// how it was counted on hover.

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';
const TONE = { danger: 'text-danger', warn: 'text-warn' } as const;

/** The period's choices in one row: the presets as links, the custom range a small form of its own (GET). */
function PeriodPicker({ employeeId, q }: { employeeId: string; q: HistoryQuery }) {
  return (
    <div className="space-y-3">
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {HISTORY_PERIOD_CHOICES.filter((p) => p.value !== 'custom').map((p) => (
          <Link
            key={p.value}
            href={historyHref(employeeId, { period: p.value })}
            scroll={false}
            aria-current={p.value === q.period ? 'page' : undefined}
            className={`${chip} ${p.value === q.period ? ACTIVE : IDLE}`}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <form key={`${q.from}-${q.to}`} action={`/employees/${employeeId}`} className="flex flex-wrap items-end gap-3" aria-label="Custom range">
        <input type="hidden" name="tab" value="attendance" />
        <input type="hidden" name="period" value="custom" />
        <div className="w-40">
          <label htmlFor="history-from" className="label">
            From
          </label>
          <DateInput id="history-from" name="from" required defaultValue={q.period === 'custom' && q.from ? formatDate(q.from) : ''} />
        </div>
        <div className="w-40">
          <label htmlFor="history-to" className="label">
            To
          </label>
          <DateInput id="history-to" name="to" required defaultValue={q.period === 'custom' && q.to ? formatDate(q.to) : ''} />
        </div>
        <button type="submit" className={`btn ${q.period === 'custom' ? 'btn-primary' : 'btn-secondary'}`}>
          Show the range
        </button>
      </form>
    </div>
  );
}

/** The figures, each with its definition on hover (title) and in the list below them. */
function Tiles({ v }: { v: AttendanceHistoryView }) {
  const tiles = historyTiles(v);
  return (
    <div className="space-y-2">
      <dl aria-label={`${v.employee.fullNameEn}'s attendance, ${v.periodLabel.toLowerCase()}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.key} className="card px-4 py-3" title={t.definition}>
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className={`mt-1 text-lg font-semibold ${t.tone ? TONE[t.tone] : ''}`}>{t.value}</dd>
            {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
          </div>
        ))}
      </dl>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">What the figures mean</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {tiles.map((t) => (
            <div key={t.key}>
              <dt className="font-medium">{t.label}</dt>
              <dd className="text-muted">{t.definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

/** A chart's table: every value the chart shows, its text version. */
function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer font-semibold">Show as a table</summary>
      <div className="card mt-2 overflow-x-auto">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((cell, i) => (
                  <td key={i} className={i ? 'tabular-nums' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Charts({ v }: { v: AttendanceHistoryView }) {
  const trend = trendChart(v.trend.points, v.trend.by);
  const bins = binsChart(v.checkIns);
  const weekdays = weekdayChart(v.weekdays);
  const by = v.trend.by === 'quarter' ? 'quarter' : 'month';
  const none = (what: string) => <p className="card px-4 py-6 text-center text-sm text-muted">{what}</p>;
  return (
    <div className="space-y-6">
      <section aria-labelledby="history-trend" className="space-y-2">
        <h3 id="history-trend" className="font-semibold">
          On-Time Trend
        </h3>
        {trend ? (
          <>
            <TrendLineChart chart={trend} caption={`The share of the days attended checked in on time, by ${by}; the larger dot is the latest.`} />
            <ChartTable
              caption={`On time by ${by}`}
              head={[by === 'quarter' ? 'Quarter' : 'Month', 'On time', 'Attendance rate']}
              rows={v.trend.points.map((p) => [p.label, trendCell(p), p.attendanceRate === null ? 'No day expected' : `${percentText(p.attendanceRate)} (${p.attendedDays} of ${p.expectedDays})`])}
            />
          </>
        ) : (
          none('No day in this period has a check-in that can be told on time or late.')
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="history-bins" className="space-y-2">
          <h3 id="history-bins" className="font-semibold">
            Check-In Times
          </h3>
          {bins ? (
            <>
              <ColumnBarChart chart={bins} caption="The first check-in of each day attended, by the 15 minutes it falls in (Cairo time)." />
              <ChartTable caption="Check-ins by 15 minutes" head={['From', 'Check-ins']} rows={v.checkIns.map((b) => [`${b.label}–${clockText(b.from + 14)}`, b.count])} />
            </>
          ) : (
            none('No check-in in this period.')
          )}
        </section>
        <section aria-labelledby="history-weekdays" className="space-y-2">
          <h3 id="history-weekdays" className="font-semibold">
            Late Days by Weekday
          </h3>
          {weekdays ? (
            <>
              <ColumnBarChart chart={weekdays} caption="Days checked in after the shift’s start and its grace minutes, on each working day of the week." />
              <ChartTable caption="Late days by weekday" head={['Weekday', 'Late days', 'Days measured']} rows={v.weekdays.map((w) => [w.label, w.lateDays, w.measuredDays])} />
            </>
          ) : (
            none('No day in this period can be told on time or late.')
          )}
        </section>
      </div>
    </div>
  );
}

/** What a day was: its mode, an official duty's linking to its request; a day worked off says so. */
function ModeCell({ d }: { d: HistoryDay }) {
  const label = HISTORY_MODE_LABELS[d.mode];
  const text =
    d.mode === 'od' && d.odRequestId ? (
      <Link href={`/attendance/official-duty/${encodeURIComponent(d.odRequestId)}`} prefetch={false} className="font-semibold">
        {label}
      </Link>
    ) : (
      d.mode === 'exempt' || d.mode === 'compensatory' ? (
        // exempt from check-in (25 October 2026), or a compensatory day off (26 October 2026): a badge, its full hours counted
        <span className="badge border border-line bg-card text-ink" title={d.mode === 'exempt' ? EXEMPT_DAY_TITLE : COMPENSATORY_DAY_TITLE}>
          {label}
          <span className="sr-only"> ({d.mode === 'exempt' ? EXEMPT_DAY_TITLE : COMPENSATORY_DAY_TITLE})</span>
        </span>
      ) : (
        <span className={d.mode === 'absent' ? 'font-semibold text-danger' : undefined}>{label}</span>
      )
    );
  return (
    <>
      {text}
      {d.offDay && <span className="block text-xs text-muted">Worked on a rest day or holiday</span>}
    </>
  );
}

/** Where a day came from: System, Zoho import, Corrected (linking to the correction). */
function SourceCell({ d }: { d: HistoryDay }) {
  const label = HISTORY_SOURCE_LABELS[d.source] ?? d.source;
  if (d.source === 'correction' && d.correctionId) {
    return (
      <Link href={`/attendance/corrections/${encodeURIComponent(d.correctionId)}`} prefetch={false}>
        {label}
      </Link>
    );
  }
  return <>{label}</>;
}

function Log({ v, q }: { v: AttendanceHistoryView; q: HistoryQuery }) {
  const id = v.employee.id;
  const { log } = v;
  const first = (log.page - 1) * log.pageSize + 1;
  const last = first + log.days.length - 1;
  return (
    <section aria-labelledby="history-log" className="space-y-3">
      <h3 id="history-log" className="font-semibold">
        Daily Log
      </h3>
      <nav aria-label="Which days" className="flex flex-wrap gap-2">
        {historyFilterChoices(v.figures).map((f) => {
          const active = f.value === log.only;
          return (
            <Link
              key={f.value ?? 'all'}
              href={historyHref(id, { ...q, only: f.value, page: 1 })}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={`${chip} ${active ? ACTIVE : IDLE}`}
            >
              {f.label}
              {f.count !== null && <span className={`tabular-nums ${active ? 'text-on-accent/80' : 'text-muted'}`}>{f.count}</span>}
            </Link>
          );
        })}
      </nav>
      {log.days.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-muted">{log.only ? 'No such day in this period.' : 'No day on record in this period.'}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Mode</th>
                <th scope="col">First in</th>
                <th scope="col">Last out</th>
                <th scope="col">Hours</th>
                <th scope="col">Late</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {log.days.map((d) => (
                <tr key={d.date} className="align-top">
                  <td className="whitespace-nowrap tabular-nums">{logDateText(d)}</td>
                  <td>
                    <ModeCell d={d} />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{d.checkIn ? cairoClock(d.checkIn) : <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {d.checkOut ? cairoClock(d.checkOut) : <span className="text-muted">—</span>}
                    <OpenPressLine pairs={dayPairs(d)} exempt={d.exempt} />
                  </td>
                  <td className="tabular-nums">
                    <span className="whitespace-nowrap">{d.status === 'worked' ? hoursText(d.hours) : <span className="text-muted">—</span>}</span>
                    <DayPairsLine pairs={dayPairs(d)} />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {d.onTime === false ? (
                      <span className="font-semibold text-warn">{lateText(d.lateMinutes)}</span>
                    ) : d.firstDay ? (
                      // a first day counted from the shift's start (27 October 2026): never late
                      <span className="text-muted" title={firstDayNote(d) ?? undefined}>
                        {FIRST_DAY_BADGE}
                        {firstDayNote(d) && <span className="sr-only"> ({firstDayNote(d)})</span>}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <SourceCell d={d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-muted tabular-nums">
              {first === last ? `Day ${first}` : `Days ${first}–${last}`} of {log.total}, the latest first
            </span>
            {log.pages > 1 && (
              <nav aria-label="Pages of the log" className="flex items-center gap-3">
                {log.page > 1 ? (
                  <Link href={historyHref(id, { ...q, page: log.page - 1 })} scroll={false} className="font-semibold">
                    ← Newer
                  </Link>
                ) : (
                  <span className="text-muted">← Newer</span>
                )}
                <span className="tabular-nums text-muted">
                  Page {log.page} of {log.pages}
                </span>
                {log.page < log.pages ? (
                  <Link href={historyHref(id, { ...q, page: log.page + 1 })} scroll={false} className="font-semibold">
                    Older →
                  </Link>
                ) : (
                  <span className="text-muted">Older →</span>
                )}
              </nav>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export async function AttendanceHistoryTab({ profile: p, query: q }: { profile: Pick<EmployeeProfile, 'id' | 'fullNameEn'>; query: HistoryQuery }) {
  const loaded = await loadJson<AttendanceHistoryView>(historyApiPath(p.id, q));
  if (loaded.kind === 'unavailable' || loaded.kind === 'forbidden') {
    return (
      <Empty>
        {p.fullNameEn}&apos;s attendance history isn&apos;t shown here. Only HR, the CEO, Finance and the Super Admin see it, and a C-level
        person&apos;s only the CEO and the Super Admin.
      </Empty>
    );
  }
  if (loaded.kind === 'failed') {
    return (
      <div className="space-y-4">
        <PeriodPicker employeeId={p.id} q={q} />
        <Empty>The attendance history could not be loaded. {loaded.messages.join(' ')}</Empty>
      </div>
    );
  }
  const v = loaded.value;
  const rehire = hasRehireGap(v);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Attendance History</h2>
          <p className="text-sm text-muted">
            {v.periodLabel}: {rangeText(v.range)}
            {v.joinedOn && ` · joined ${formatDate(v.joinedOn)}`}
            {v.firstRecord && v.firstRecord > v.range.from && ` · on record from ${formatDate(v.firstRecord)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={historyMonthHref(v.employee.id, v.range)} className="text-sm font-semibold">
            Month by month
          </Link>
          {/* the API records each download: never prefetched */}
          <a href={historyExcelHref(v.employee.id, q)} className="btn btn-secondary">
            Export to Excel
          </a>
        </div>
      </div>
      <PeriodPicker employeeId={v.employee.id} q={q} />
      {rehire && (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm">
          Rehired: since joining is from the first join date, and the days between two employments are left out (neither expected nor absent).
        </p>
      )}
      {v.figures.daysOnRecord === 0 ? (
        <Empty>
          No attendance on record for {v.employee.fullNameEn} in this period: they haven&apos;t checked in on the system, and no Zoho People attendance
          was imported for these days.
        </Empty>
      ) : (
        <>
          <Tiles v={v} />
          <Charts v={v} />
          <Log v={v} q={q} />
        </>
      )}
      <p className="text-xs text-muted">
        The days on record only: Zoho People&apos;s imports, the system&apos;s check-ins (from the first one, every working day gone by) and the
        corrections. Worked out {formatDateTime(v.generatedAt)}.
      </p>
    </div>
  );
}
