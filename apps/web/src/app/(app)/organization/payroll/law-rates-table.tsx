import type { LawRatesView } from '@/lib/types';
import { formatMoney, formatPercent } from '../../employees/[id]/contracts/salary';
import { beforeTaxLimitText, changedText, limitsText, tierLabels, tiersSummary } from './law-rates';

// The years' rates set by law as Rates Set by Law lists them (owner's request, 16 October 2026), oldest year first:
// each year's values (the minimum wage since 18 October 2026, "Not set" until the owner sets it), its salary tax summed
// up with every tier and band behind it, and who changed it last. Read-only here; the Super Admin's buttons come in
// `actions`. No hooks, so the section renders it on the server for those who
// only read the rates.

const quiet = 'block text-xs text-muted';

/** A year's tiers and bands, opened from their summary. */
function TaxTiers({ view }: { view: LawRatesView }) {
  const tiers = tierLabels(view.taxTiers);
  return (
    <details className="min-w-56">
      <summary className="cursor-pointer whitespace-nowrap text-accent">{tiersSummary(view.taxTiers)}</summary>
      <p className="mt-2 max-w-72 text-xs text-muted">
        {tiers.length > 1
          ? "The tier is chosen by the whole annual net income, and the whole income is taxed on that tier's bands, from 0."
          : 'The annual net income is taxed on these bands, from 0.'}
      </p>
      <ol className="mt-2 space-y-2">
        {tiers.map((t, i) => (
          <li key={t.range}>
            {tiers.length > 1 && (
              <span className="block font-medium whitespace-nowrap">
                Tier {i + 1}: {t.range} a year
              </span>
            )}
            <ul className="text-muted">
              {t.bands.map((b) => (
                <li key={b} className="whitespace-nowrap">
                  {b}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LawRatesTable({
  views,
  currentYear,
  actions,
}: {
  views: readonly LawRatesView[];
  /** The year whose rates apply today (lawRatesFor this year): marked "Applies now". */
  currentYear: number | null;
  /** The Super Admin's buttons for a year (Change, Delete). */
  actions?: (view: LawRatesView) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="table">
        <caption className="sr-only">The rates set by law, by the year they apply from</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">Social insurance</th>
            <th scope="col">Insurable wage</th>
            <th scope="col">Personal exemption</th>
            <th scope="col">Martyrs&apos; Fund</th>
            <th scope="col">Health insurance</th>
            <th scope="col">Minimum wage</th>
            <th scope="col">Salary tax</th>
            <th scope="col">Last changed</th>
            {actions && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {views.map((v) => {
            const changed = changedText(v);
            return (
              <tr key={v.year}>
                <td className="align-top">
                  <span className="font-semibold tabular-nums">{v.year}</span>
                  {v.year === currentYear && <span className="badge mt-1 block w-fit">Applies now</span>}
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {formatPercent(v.employeeInsuranceRate)} employee
                  <span className={quiet}>{formatPercent(v.employerInsuranceRate)} company</span>
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {limitsText(v)}
                  <span className={quiet}>EGP a month</span>
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {formatMoney(v.personalExemption)}
                  <span className={quiet}>EGP a year</span>
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {formatPercent(v.martyrsRate)}
                  <span className={quiet}>of the taxed pay</span>
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {formatPercent(v.healthInsuranceRate)}
                  <span className={quiet}>{v.healthInsuranceRate > 0 ? 'of the taxed pay' : 'not applied'}</span>
                  {/* the limit on the share deducted before tax (20 October 2026) */}
                  <span className={quiet}>{beforeTaxLimitText(v)}</span>
                </td>
                <td className="align-top whitespace-nowrap tabular-nums">
                  {typeof v.minimumWage === 'number' ? (
                    <>
                      {formatMoney(v.minimumWage)}
                      <span className={quiet}>EGP a month</span>
                    </>
                  ) : (
                    <span className="text-muted">Not set</span>
                  )}
                </td>
                <td className="align-top tabular-nums">
                  <TaxTiers view={v} />
                </td>
                <td className="align-top whitespace-nowrap">
                  {changed.who}
                  <span className={quiet}>{changed.when}</span>
                </td>
                {actions && <td className="align-top whitespace-nowrap">{actions(v)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
