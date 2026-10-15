import { INSURABLE_WAGE, SALARY_RULES } from '@trendlix/shared';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { formatAmount, formatPercent } from '../../employees/[id]/contracts/salary';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { canSeeContracts } from '../list';
import { bracketLabels, calculatorYears, readCalculatorQuery, TAX_TIERS, TOP_TIER } from './calculator';
import { SalaryCalculator } from './salary-calculator';

// The Salary Calculator (owner, 15 October 2026: "add the calculation method to calculate the net and gross salary"):
// a gross's net, or the gross for a net, step by step, as the Ministry of Finance's salary tax system works it out. The
// contract form shows the same calculation for a contract's salary. For HR, the CEO and Finance, like the Contracts
// page; it is worked out in the browser and asks the API nothing.

async function Calculator({ searchParams }: { searchParams: PageProps<'/contracts/calculator'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!canSeeContracts(user)) return <Empty>Only HR, the CEO and Finance can use the salary calculator.</Empty>;
  const thisYear = Number(todayInCairo().slice(0, 4));
  return (
    <>
      <SalaryCalculator initial={readCalculatorQuery(await searchParams, thisYear)} years={calculatorYears(thisYear)} />
      <HowItsCalculated />
    </>
  );
}

function HowItsCalculated() {
  const r = SALARY_RULES;
  const limits = Object.entries(INSURABLE_WAGE)
    .map(([year, { min, max }]) => `${year}: ${formatAmount(min)} to ${formatAmount(max)}`)
    .join('; ');
  return (
    <section aria-labelledby="calculator-how" className="card max-w-3xl p-5">
      <h2 id="calculator-how" className="font-semibold">
        How It&apos;s Calculated
      </h2>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        <li>
          Social insurance: {formatPercent(r.employeeInsuranceRate)} of the insured wage, which is the gross capped at the year&apos;s maximum insurable wage
          and never below its minimum ({limits}). The company pays {formatPercent(r.employerInsuranceRate)} on the same wage (Law 148/2019).
        </li>
        <li>Monthly taxable: the gross less the employee&apos;s social insurance. Comprehensive health insurance doesn&apos;t apply in Cairo yet.</li>
        <li>
          Annual net income: the monthly taxable × 12, less the {formatAmount(r.personalExemption)} personal exemption, rounded down to{' '}
          {r.roundIncomeDownTo} pounds.
        </li>
        <li>
          Salary tax on the annual net income, in Law 7/2024&apos;s brackets:
          <ul className="mt-1 list-disc pl-5 tabular-nums">
            {bracketLabels().map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-1">
            Above {formatAmount(TAX_TIERS[0].over)} a year the whole income moves to a higher tier, and its first part is taxed at a higher rate:{' '}
            {TAX_TIERS.map((t) => `above ${formatAmount(t.over)}, the first ${formatAmount(t.firstUpTo)} at ${formatPercent(t.rate)}`).join('; ')}. Above{' '}
            {formatAmount(TOP_TIER.over)}, {formatPercent(TOP_TIER.below)} up to it and {formatPercent(TOP_TIER.rate)} on the rest. So the tax jumps at each
            tier&apos;s limit. The monthly tax is the annual tax ÷ 12.
          </p>
        </li>
        <li>Martyrs&apos; Fund: {formatPercent(r.martyrsRate)} of the gross (Law 4/2021).</li>
        <li>
          Net: the gross less the social insurance, the monthly tax and the Martyrs&apos; Fund. Company cost: the gross plus the company&apos;s social
          insurance.
        </li>
        <li>
          From a net: the lowest whole-pound gross whose net reaches it, so its net can be up to a pound more than asked. Just past a tier&apos;s limit a
          higher gross gives a lower net, as the tax jumps.
        </li>
      </ol>
      <p className="hint">Assumes the full gross, including the variable part, is paid, and the same salary all year.</p>
    </section>
  );
}

export default function SalaryCalculatorPage({ searchParams }: PageProps<'/contracts/calculator'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <BackLink href="/contracts">Contracts</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Salary Calculator</h1>
        <p className="mt-1 max-w-3xl text-muted">
          A gross salary&apos;s net, or the gross for a net, step by step, as the Ministry of Finance&apos;s salary tax system works it out: social insurance
          on the insured wage, salary tax in Law 7/2024&apos;s brackets, and the Martyrs&apos; Fund. The address keeps what you type, to share a result.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Calculator searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
