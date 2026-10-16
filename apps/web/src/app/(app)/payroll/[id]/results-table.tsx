'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import type { PayrollRules } from '@trendlix/shared';
import { GroupHeading } from '@/components/group-heading';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import type { PayrollLineView, PayrollTotals } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { profileHref } from '../../employees/tab-list';
import { payslipHref } from '../payslips';
import { breakdown, cutText, type BreakdownRow } from './breakdown';

// The run's results (owner's decisions, 16 October 2026): what each employee earned, what is deducted, the net and what
// the bank transfers, with the run's totals. Each row opens to every step of the employee's pay and its warnings, as
// payrollLine worked them out. Once the run is paid, each employee's English payslip opens from its row (a plain link,
// never prefetched: the web server fetches the PDF from the API with the session); someone on hold that month was not
// paid, so has none.

const TONE: Record<BreakdownRow['kind'], string> = {
  add: '',
  cut: 'text-danger',
  total: 'font-semibold',
  info: 'text-muted',
};

function Breakdown({ line, rules }: { line: PayrollLineView; rules: PayrollRules }) {
  const steps = breakdown(line, rules);
  return (
    <div className="space-y-4 bg-canvas px-4 py-4">
      {line.result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {line.result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <div key={s.key} className={`flex items-baseline justify-between gap-4 border-b border-line-soft py-1.5 ${s.kind === 'total' ? 'border-line' : ''}`}>
            <dt className="text-sm">
              <span className={s.kind === 'total' ? 'font-semibold' : undefined}>{s.label}</span>
              {s.note && <span className="block text-xs text-muted">{s.note}</span>}
            </dt>
            <dd className={`text-sm whitespace-nowrap tabular-nums ${TONE[s.kind]}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
      {line.comments && (
        <p className="text-sm">
          <span className="text-muted">Comments: </span>
          {line.comments}
        </p>
      )}
    </div>
  );
}

const COLUMNS = ['Earned', 'Allowances', 'Social Ins.', 'Tax', 'Martyrs’', 'Deductions', 'Net', 'Transfer'] as const;

function Amounts({ values }: { values: { earned: number; allowances: number; employeeInsurance: number; monthlyTax: number; martyrsFund: number; deductions: number; net: number; transfer: number } }) {
  const v = values;
  return (
    <>
      <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(v.earned)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(v.allowances)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{cutText(v.employeeInsurance)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{cutText(v.monthlyTax)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{cutText(v.martyrsFund)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{cutText(v.deductions)}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(v.net)}</td>
      <td className={`text-right whitespace-nowrap tabular-nums ${v.transfer < 0 ? 'text-danger' : ''}`}>{formatEgp(v.transfer)}</td>
    </>
  );
}

export function ResultsTable({
  lines,
  totals,
  rules,
  payslips,
}: {
  lines: PayrollLineView[];
  totals: PayrollTotals;
  rules: PayrollRules;
  /** The run is paid: each line not on hold has its payslip. */
  payslips: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((all) => {
      const next = new Set(all);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allOpen = lines.length > 0 && lines.every((l) => open.has(l.id));
  // by department, then by team (owner's request, 16 October 2026)
  const groups = groupByPlace(lines, (l) => l.department);
  const span = COLUMNS.length + (payslips ? 2 : 1);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(lines.map((l) => l.id)))} className="text-sm font-semibold text-accent hover:underline">
          {allOpen ? 'Close every breakdown' : 'Open every breakdown'}
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className="text-right">
                  {c}
                </th>
              ))}
              {payslips && <th scope="col">Payslip</th>}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.department ?? ''}>
              {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={span} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={span} />}
                  {t.rows.map((l) => {
                    const expanded = open.has(l.id);
                    const panel = `payroll-breakdown-${l.id}`;
                    return (
                      <Fragment key={l.id}>
                        <tr>
                          <td className="min-w-56">
                            <button
                              type="button"
                              onClick={() => toggle(l.id)}
                              aria-expanded={expanded}
                              aria-controls={panel}
                              className="flex items-start gap-2 text-left"
                            >
                              <span aria-hidden="true" className={`mt-0.5 inline-block text-xs text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                              <span>
                                <span className="font-semibold text-ink">{l.name}</span>
                                <span className="sr-only">: {expanded ? 'close' : 'open'} the breakdown</span>
                                <span className="block text-xs text-muted">
                                  <span className="tabular-nums">{l.employeeCode}</span>
                                </span>
                              </span>
                            </button>
                            <div className="mt-1 flex flex-wrap gap-1 pl-5">
                              {l.onHold && <span className="badge bg-warn-soft text-warn">On hold</span>}
                              {l.result.warnings.length > 0 && (
                                <span className="badge bg-warn-soft text-warn">
                                  {l.result.warnings.length} {l.result.warnings.length === 1 ? 'warning' : 'warnings'}
                                </span>
                              )}
                            </div>
                          </td>
                          <Amounts values={l.result} />
                          {payslips && (
                            <td className="whitespace-nowrap">
                              {!l.onHold && (
                                <a href={payslipHref(l.id, 'en')} target="_blank" rel="noopener" className="text-sm font-semibold text-accent hover:underline">
                                  Payslip<span className="sr-only"> of {l.name} (English PDF), in a new tab</span>
                                </a>
                              )}
                            </td>
                          )}
                        </tr>
                        {expanded && (
                          <tr id={panel}>
                            <td colSpan={span} className="p-0">
                              <Breakdown line={l} rules={rules} />
                              <p className="px-4 pb-3 text-xs text-muted">
                                <Link href={profileHref(l.employeeId, 'contracts')}>Open {l.name}&apos;s contract</Link>
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="font-semibold">
              <td className="border-t border-line">
                Total
                <span className="block text-xs font-normal text-muted">
                  {totals.employees} {totals.employees === 1 ? 'employee' : 'employees'}
                </span>
              </td>
              <Amounts values={totals} />
              {payslips && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
