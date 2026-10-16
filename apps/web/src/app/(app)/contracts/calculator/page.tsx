import { Suspense } from 'react';
import { loadLawRates } from '@/lib/law-rates';
import { getCurrentUser } from '@/lib/session';
import { loadAllowanceTypes } from '../../employees/[id]/contracts/data';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { canSeeContracts } from '../list';
import { calculatorYears, readCalculatorQuery } from './calculator';
import { SalaryCalculator } from './salary-calculator';

// The Salary Calculator (owner, 15 October 2026: "add the calculation method to calculate the net and gross salary"):
// a gross's net, or the gross for a net, step by step, as the Ministry of Finance's salary tax system works it out, for
// a monthly salary or pay by the hour, with allowances on top (the owner's requests of the same day). The contract form
// shows the same calculation for a contract's salary. For HR, the CEO and Finance, like the Contracts page; it is
// worked out in the browser, and asks the API only for the kinds of allowance and the rates set by law of each year
// (owner's request, 16 October 2026: the Super Admin keeps them in Organization → Payroll), whose years it offers.

async function Calculator({ searchParams }: { searchParams: PageProps<'/contracts/calculator'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!canSeeContracts(user)) return <Empty>Only HR, the CEO and Finance can use the salary calculator.</Empty>;
  const thisYear = Number(todayInCairo().slice(0, 4));
  const [query, allowanceTypes, lawYears] = await Promise.all([searchParams, loadAllowanceTypes(), loadLawRates()]);
  const initial = readCalculatorQuery(query, thisYear, lawYears);
  // an allowance of a kind that no longer exists (e.g. in an old address) is left out
  initial.allowances = initial.allowances.filter((a) => allowanceTypes.some((t) => t.id === a.allowanceTypeId));
  return <SalaryCalculator initial={initial} years={calculatorYears(thisYear, lawYears)} lawYears={lawYears} allowanceTypes={allowanceTypes} />;
}

export default function SalaryCalculatorPage({ searchParams }: PageProps<'/contracts/calculator'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <BackLink href="/contracts">Contracts</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Salary Calculator</h1>
        <p className="mt-1 max-w-3xl text-muted">
          A gross salary&apos;s net, or the gross for a net, step by step, as the Ministry of Finance&apos;s salary tax system works it out: social insurance
          on the insured wage, salary tax in its tiers, and the Martyrs&apos; Fund. For a monthly salary or pay by the hour (from the gross
          or the net per hour), with any allowances on top. The address keeps what you type, to share a result.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Calculator searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
