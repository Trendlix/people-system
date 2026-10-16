import { ROUND_INCOME_DOWN_TO, type LawRates } from '@trendlix/shared';
import { formatMoney, formatPercent, ratesYearText } from '../../employees/[id]/contracts/salary';
import { limitsText, tierLabels } from '../../organization/payroll/law-rates';

// The Salary Calculator's "How It's Calculated" list, for the year chosen in it: its rates, limits, exemption and tax
// tiers are that year's rates set by law (owner's request, 16 October 2026: the Super Admin keeps them by year in
// Organization → Payroll, and changes them if the law changes), so the list says what the table works out.

export function HowItsCalculated({ year, rates, lawYears }: { year: number; rates: LawRates; lawYears: readonly LawRates[] }) {
  const limits = lawYears.map((r) => `${r.year}: ${limitsText(r)}`).join('; ');
  const tiers = tierLabels(rates.taxTiers);
  const health = rates.healthInsuranceRate;
  return (
    <section aria-labelledby="calculator-how" className="card max-w-3xl p-5">
      <h2 id="calculator-how" className="font-semibold">
        How It&apos;s Calculated
      </h2>
      <p className="mt-1 text-sm text-muted">With {ratesYearText(year, rates)}, as kept in Organization → Payroll.</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        <li>
          By the hour, the gross is the monthly estimate: the hourly rate × the hours a week × 52 ÷ 12. Allowances are paid every month on top of the gross,
          each kind taxed or not and insured or not as HR sets it in Organization → Allowances: a cash allowance is taxed with the salary (Law 91/2005 Art.
          9), and only transport the company itself provides is exempt.
        </li>
        <li>
          Social insurance: {formatPercent(rates.employeeInsuranceRate)} of the insured wage, which is the gross and the insured allowances, capped at the
          year&apos;s maximum insurable wage and never below its minimum ({limits}). The company pays {formatPercent(rates.employerInsuranceRate)} on the
          same wage (Law 148/2019).
        </li>
        <li>
          Monthly taxable: the gross and the taxed allowances, less the employee&apos;s social insurance
          {health > 0
            ? ` and comprehensive health insurance, ${formatPercent(health)} of the gross and the taxed allowances (Law 2/2018).`
            : ". Comprehensive health insurance is 0%: it doesn't apply in Cairo yet."}
        </li>
        <li>
          Annual net income: the monthly taxable × 12, less the {formatMoney(rates.personalExemption)} personal exemption, rounded down to{' '}
          {ROUND_INCOME_DOWN_TO} pounds.
        </li>
        <li>
          {tiers.length > 1
            ? "Salary tax on the annual net income, in its tiers: the tier is chosen by the whole annual net income, and the whole income is taxed on that tier's bands, from 0. So the tax jumps at each tier's limit."
            : 'Salary tax on the annual net income, in these bands, from 0:'}
          <ul className="mt-1 list-disc space-y-1 pl-5 tabular-nums">
            {tiers.map((t) => (
              <li key={t.range}>
                {tiers.length > 1 && <span className="font-medium">{t.range} a year: </span>}
                {t.bands.join('; ')}
              </li>
            ))}
          </ul>
          <p className="mt-1">The monthly tax is the annual tax ÷ 12.</p>
        </li>
        <li>Martyrs&apos; Fund: {formatPercent(rates.martyrsRate)} of the gross and the taxed allowances (Law 4/2021).</li>
        <li>
          Net: the gross and every allowance, less the social insurance{health > 0 ? ', the health insurance' : ''}, the monthly tax and the Martyrs&apos;
          Fund. Company cost: the gross and the allowances, plus the company&apos;s social insurance.
        </li>
        <li>
          From a net (allowances included): the lowest whole-pound gross whose net reaches it, so its net can be up to a pound more than asked. Just past a
          tier&apos;s limit a higher gross gives a lower net, as the tax jumps.
        </li>
        <li>
          By the hour, from a net per hour (allowances included): the lowest gross rate, to the piaster, whose monthly estimate&apos;s net reaches the net per
          hour × the hours a week × 52 ÷ 12, so its net per hour can be a piaster or so more than asked. A gross rate typed before that already gives that net
          per hour is kept. The net per hour shown is the month&apos;s net ÷ (the hours a week × 52 ÷ 12).
        </li>
      </ol>
      <p className="hint">Assumes the full gross, including the variable part, is paid, and the same salary all year.</p>
    </section>
  );
}
