import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { END_REASON_LABELS, LEAVER_KIND_LABELS, tenureText, type EndReason, type TurnoverCount, type TurnoverReport } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { loadTurnover, offboardingNotLoaded } from '../data';
import { managesOffboarding, monthLabel, OFFBOARDING_PATH, percentText, readTurnoverYear, TURNOVER_PATH, turnoverExcelHref } from '../offboarding';

// Turnover (owner, 22 October 2026: the full module: "turnover numbers"; the brief: "leavers per month and year;
// turnover rate (leavers ÷ average headcount); voluntary versus involuntary; by department, reason and tenure band; and
// the average tenure at exit. Excel"): a year (?year=) at a glance, its months (the one going on counted so far), by
// department, reason and tenure, and who left. Freelancers are outside the labour law, so outside the numbers. A C-level
// person is counted but not named to HR. HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Turnover · People System' };

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Counts({ title, label, rows, total }: { title: string; label: string; rows: readonly TurnoverCount[]; total: number }) {
  return (
    <section className="card overflow-x-auto">
      <h2 className="px-4 pt-4 text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">Nobody left this year.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{label}</th>
              <th className="text-right">Leavers</th>
              <th className="text-right">Voluntary</th>
              <th className="w-1/3">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="text-right tabular-nums">{r.leavers}</td>
                <td className="text-right tabular-nums">{r.voluntary}</td>
                <td>
                  <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-line-soft">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((r.leavers / total) * 100) : 0}%` }} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Report({ t }: { t: TurnoverReport }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leavers" value={String(t.leavers)} note={`${t.voluntary} voluntary · ${t.involuntary} involuntary${t.other ? ` · ${t.other} other` : ''}`} />
        <Tile label="Turnover rate" value={percentText(t.rate)} note={`Leavers ÷ average headcount (${t.averageHeadcount})`} />
        <Tile
          label="Voluntary turnover"
          value={percentText(t.averageHeadcount > 0 ? Math.round((t.voluntary / t.averageHeadcount) * 1000) / 10 : null)}
          note="Resigned, mutual agreement or retired"
        />
        <Tile label="Average tenure at exit" value={t.averageTenureMonths === null ? '—' : tenureText(Math.round(t.averageTenureMonths))} />
      </div>

      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 text-lg font-semibold">By Month</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">Headcount</th>
              <th className="text-right">Leavers</th>
              <th className="text-right">Voluntary</th>
              <th className="text-right">Involuntary</th>
              <th className="text-right">Turnover</th>
            </tr>
          </thead>
          <tbody>
            {t.months.map((m) => (
              <tr key={m.month}>
                <td>
                  {monthLabel(m.month)}
                  {m.partial && <span className="text-xs text-muted"> · so far</span>}
                </td>
                <td className="text-right tabular-nums">
                  {m.start} → {m.end}
                </td>
                <td className="text-right tabular-nums">{m.leavers}</td>
                <td className="text-right tabular-nums">{m.voluntary}</td>
                <td className="text-right tabular-nums">{m.involuntary}</td>
                <td className="text-right tabular-nums">{percentText(m.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Counts title="By Department" label="Department" rows={t.byDepartment} total={t.leavers} />
        <Counts title="By Reason" label="Reason" rows={t.byReason} total={t.leavers} />
        <Counts title="By Tenure" label="Tenure" rows={t.byTenure} total={t.leavers} />
      </div>

      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 text-lg font-semibold">Who Left</h2>
        {t.leaversList.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nobody left this year.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Last Working Day</th>
                <th>Reason</th>
                <th>Department</th>
                <th>Tenure</th>
              </tr>
            </thead>
            <tbody>
              {t.leaversList.map((l, i) => (
                <tr key={`${l.employee?.id ?? 'hidden'}-${l.endDate}-${i}`}>
                  <td>{l.employee ? <Link href={`/employees/${l.employee.id}`}>{l.employee.fullNameEn}</Link> : <span className="text-muted">C-level (hidden)</span>}</td>
                  <td className="tabular-nums">{formatDate(l.endDate)}</td>
                  <td>
                    {l.endReason ? (END_REASON_LABELS[l.endReason as EndReason] ?? l.endReason) : '—'}
                    <div className="text-xs text-muted">{LEAVER_KIND_LABELS[l.leaverKind]}</div>
                  </td>
                  <td>{l.department ?? '—'}</td>
                  <td>{tenureText(l.tenureMonths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

async function Turnover({ searchParams }: { searchParams: PageProps<'/offboarding/turnover'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!managesOffboarding(user)) return <Empty>Only HR, the CEO and a Super Admin see the turnover.</Empty>;
  const year = readTurnoverYear(query, todayInCairo());
  const loaded = await loadTurnover(year);
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'turnover')}</Empty>;
  const t = loaded.value;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <form action={TURNOVER_PATH} className="flex items-end gap-2">
          <div>
            <label htmlFor="turnover-year" className="label">
              Year
            </label>
            <Select id="turnover-year" name="year" defaultValue={String(t.year)} className="input min-w-32">
              {t.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className="btn btn-secondary">
            Show
          </button>
        </form>
        <a href={turnoverExcelHref(t.year)} className="btn btn-secondary no-underline">
          Download Excel
        </a>
      </div>
      <Report t={t} />
    </div>
  );
}

export default function TurnoverPage({ searchParams }: PageProps<'/offboarding/turnover'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <BackLink href={OFFBOARDING_PATH}>Offboarding</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Turnover</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Who left in the year and how many, against the average headcount: voluntary (resigned, mutual agreement, retired) or involuntary (terminated, a
          fixed term or an internship agreement not renewed), by department, reason and how long they stayed. Freelancers are left out.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Turnover searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
