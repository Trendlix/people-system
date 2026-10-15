import { formatEgp, type BreakdownRow } from './salary';

// The contract form's monthly breakdown of the salary (rows from `breakdownRows`): what is deducted from the gross, the
// net, and in a quieter line what the employee costs the company.

const ROW: Record<BreakdownRow['kind'], string> = {
  amount: '',
  addition: '',
  deduction: '',
  total: 'border-t border-line font-semibold',
  company: 'text-xs text-muted',
};

export function SalaryBreakdownList({ rows, labelledBy }: { rows: BreakdownRow[]; labelledBy?: string }) {
  return (
    <dl aria-labelledby={labelledBy} className="rounded-lg border border-line bg-canvas text-sm">
      {rows.map((r) => (
        <div key={r.label} className={`flex items-baseline justify-between gap-4 px-4 py-2 ${ROW[r.kind]}`}>
          <dt>
            {r.label}
            {r.note && <span className="text-muted"> ({r.note})</span>}
          </dt>
          <dd className="shrink-0 text-right whitespace-nowrap tabular-nums">
            {r.kind === 'deduction' && '− '}
            {r.kind === 'addition' && '+ '}
            {formatEgp(r.amount)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
