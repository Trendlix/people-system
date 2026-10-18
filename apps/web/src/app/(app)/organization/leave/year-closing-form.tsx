'use client';

import { Fragment, useMemo, useState } from 'react';
import { GroupHeading } from '@/components/group-heading';
import { FormErrors, useKeptForm } from '@/components/form';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import type { FormState, YearClosingRow } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { placeOfEmployee } from '../../leave/list';
import { balanceSplit, carriedText, carryRest, cellName, checkRow, closingTotals, payAll, payoutText, startingSplit, type TypedSplit } from './year-closing';

// Organization → Leave → Year Closing (owner, 18 October 2026: "make it with decision with the year closing"): a row for
// each employee with unused annual days, grouped by department, then team: the days unused, those carried in by the year
// they were earned in, those carried for three years that must be paid now (highlighted: Art. 125, "كل ثلاث سنوات على
// الأكثر"), and HR's two inputs, the days carried into the next year and the days paid, which must add up to the days
// unused (typing one fills the other in), with the day rate and what the pay comes to. Close the year stays off while a
// row is wrong. A closed year is shown as decided, read only.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const SPAN = 8;
const cellInput = 'input min-h-9 w-20 px-2 py-1 text-right tabular-nums';
const days = (n: number) => (Number.isNaN(n) ? '—' : String(n));

/** A closed year's form sends nothing. */
const READ_ONLY: Action = async () => ({});

export function YearClosingForm({ action, year, rows, closed }: { action: Action | null; year: number; rows: YearClosingRow[]; closed: boolean }) {
  const { state, pending, form } = useKeptForm(action ?? READ_ONLY);
  const editable = !!action && !closed;
  const [typed, setTyped] = useState<Record<string, TypedSplit>>(() =>
    Object.fromEntries(
      rows.map((r) => {
        const kept = state.values;
        return [r.employee.id, kept ? { carry: String(kept[cellName('carry', r.employee.id)] ?? r.carry), pay: String(kept[cellName('pay', r.employee.id)] ?? r.pay) } : startingSplit(r)];
      }),
    ),
  );
  const checks = useMemo(() => rows.map((r) => checkRow(r, typed[r.employee.id] ?? startingSplit(r))), [rows, typed]);
  const byId = new Map(rows.map((r, i) => [r.employee.id, i]));
  const totals = closingTotals(rows, checks);
  const groups = groupByPlace(rows, (r) => placeOfEmployee(r.employee));
  const blocked = !editable || pending || totals.problems > 0 || rows.length === 0;

  function type(row: YearClosingRow, field: keyof TypedSplit, value: string) {
    setTyped((all) => ({ ...all, [row.employee.id]: balanceSplit(row, { ...all[row.employee.id], [field]: value }, field) }));
  }
  const fill = (to: (r: YearClosingRow) => TypedSplit) => setTyped(Object.fromEntries(rows.map((r) => [r.employee.id, to(r)])));

  return (
    <form
      {...form}
      onSubmit={(e) => {
        if (blocked || !window.confirm(`Close ${year}? ${totals.carry} days are carried into ${year + 1}, and ${totals.pay} days are paid (${formatEgp(totals.amount)}) with the payroll of January ${year + 1}, or the next one open.`)) {
          e.preventDefault();
          return;
        }
        form.onSubmit(e);
      }}
      aria-label={`Year closing of ${year}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Fill in:</span>
          <button type="button" onClick={() => fill(carryRest)} className="btn btn-secondary min-h-9 px-3">
            Carry all but what must be paid
          </button>
          <button type="button" onClick={() => fill(payAll)} className="btn btn-secondary min-h-9 px-3">
            Pay all
          </button>
          <button type="button" onClick={() => fill(startingSplit)} className="btn btn-secondary min-h-9 px-3">
            As proposed
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-48 bg-card">
                Employee
              </th>
              <th scope="col" className="text-right">
                Unused
              </th>
              <th scope="col">Carried In</th>
              <th scope="col" className="text-right">
                Must Be Paid
              </th>
              <th scope="col" className="text-right">
                Carry to {year + 1}
              </th>
              <th scope="col" className="text-right">
                Pay
              </th>
              <th scope="col" className="text-right">
                Day Rate
              </th>
              <th scope="col" className="text-right">
                Pay Amount
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.department ?? ''}>
              {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={SPAN} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={SPAN} />}
                  {t.rows.map((r) => {
                    const i = byId.get(r.employee.id)!;
                    const check = checks[i];
                    const cells = typed[r.employee.id] ?? startingSplit(r);
                    const due = r.mustSettle > 0;
                    const wrong = editable && check.problems.length > 0;
                    const problemId = `closing-problem-${r.employee.id}`;
                    return (
                      <tr key={r.employee.id} className={`align-top ${due ? 'bg-warn-soft/50' : ''}`}>
                        <th scope="row" className={`sticky left-0 z-10 px-4 py-3 text-left font-normal ${due ? 'bg-warn-soft' : 'bg-card'}`}>
                          <span className="font-semibold">{r.employee.fullNameEn}</span>
                          {/* what the law asks for that can't be enforced (Art. 125): flagged, not blocked */}
                          {(r.flags ?? []).map((f) => (
                            <span key={f} className="mt-0.5 block max-w-64 text-xs text-warn">
                              {f}
                            </span>
                          ))}
                          {wrong && (
                            <ul id={problemId} className="mt-1 max-w-64 space-y-0.5 text-xs text-danger">
                              {check.problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          )}
                          <input type="hidden" name="employeeId" value={r.employee.id} />
                        </th>
                        <td className="text-right font-semibold tabular-nums">{r.unused}</td>
                        <td className="min-w-32 text-xs text-muted tabular-nums">{carriedText(r.carriedByYear) ?? '—'}</td>
                        <td className="text-right tabular-nums">
                          {due ? (
                            <span className="badge bg-warn-soft text-warn" title="Carried for three years: settled now (Labour Law Art. 125)">
                              {r.mustSettle} days
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        {(['carry', 'pay'] as const).map((field) => (
                          <td key={field} className="px-2 py-2 text-right">
                            {editable && r.unused >= 0 ? (
                              <input
                                name={cellName(field, r.employee.id)}
                                value={cells[field]}
                                onChange={(e) => type(r, field, e.target.value)}
                                inputMode="decimal"
                                autoComplete="off"
                                aria-label={`${field === 'carry' ? `Days carried to ${year + 1}` : 'Days paid'} for ${r.employee.fullNameEn}`}
                                aria-invalid={wrong || undefined}
                                aria-describedby={wrong ? problemId : undefined}
                                className={`${cellInput} ${wrong ? 'border-danger bg-danger-soft/40' : ''}`}
                              />
                            ) : (
                              <>
                                <span className="tabular-nums">{days(field === 'carry' ? check.carry : check.pay)}</span>
                                {editable && <input type="hidden" name={cellName(field, r.employee.id)} value={cells[field]} />}
                              </>
                            )}
                          </td>
                        ))}
                        <td className="text-right whitespace-nowrap text-muted tabular-nums">{formatEgp(r.dayRate)}</td>
                        <td className="text-right font-medium whitespace-nowrap tabular-nums">
                          {check.amount ? formatEgp(check.amount) : <span className="text-muted">—</span>}
                          {payoutText(r.payout) && <span className="block text-xs font-normal text-muted">{payoutText(r.payout)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left">
                Total
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{totals.unused}</td>
              <td />
              <td />
              <td className="px-4 py-3 text-right tabular-nums">{totals.carry}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totals.pay}</td>
              <td />
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatEgp(totals.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={blocked} className="btn btn-primary">
            {pending ? 'Closing…' : `Close ${year}`}
          </button>
          <p role="status" className={`text-sm ${totals.problems ? 'text-danger' : 'text-muted'}`}>
            {totals.problems
              ? `${totals.problems} ${totals.problems === 1 ? 'row needs' : 'rows need'} putting right: the days carried and paid must add up to the days unused.`
              : `${totals.carry} days carried into ${year + 1}; ${totals.pay} days paid, ${formatEgp(totals.amount)}, with the January ${year + 1} payroll.`}
          </p>
        </div>
      )}
    </form>
  );
}
