import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { CONTRACTS_REPORT_PATH } from '../payroll/reports/contracts/contracts-report';
import { AllContracts } from './all-contracts';
import { NeedsAttention } from './attention';
import { canSeeContracts, seesSalary } from './list';

// Contracts across the company, in one place (owner, October 2026: "I can't see the contracts tab in the sidebar"):
// what needs attention, then every contract. Each contract is still drafted, signed and renewed on the employee's
// Employment tab; the defaults and ending rules are under Organization → Contracts & Endings. HR, the CEO and Finance
// see it; the API checks every request again.

async function Contracts({ searchParams }: { searchParams: PageProps<'/contracts'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!canSeeContracts(user)) return <Empty>Only HR, the CEO and Finance can see contracts.</Empty>;

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Needs Attention</h2>
        {/* each part loads on its own */}
        <Suspense fallback={<Loading />}>
          <NeedsAttention user={user} />
        </Suspense>
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">All Contracts</h2>
        <Suspense fallback={<Loading />}>
          <AllContracts searchParams={searchParams} salary={seesSalary(user)} />
        </Suspense>
      </section>
    </div>
  );
}

export default function ContractsPage({ searchParams }: PageProps<'/contracts'>) {
  return (
    <div className="max-w-6xl">
      <h1 className="page-title">Contracts</h1>
      <p className="mt-1 text-muted">
        Every employee&apos;s contracts in one place; each is drafted, signed and renewed on the employee&apos;s Employment tab. Their{' '}
        <Link href="/organization/contracts">defaults and ending rules</Link> are under Organization → Contracts &amp; Endings.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/contracts/calculator" className="btn btn-secondary">Salary calculator</Link>
        {/* status, start and end dates with an Excel download (owner, 25 October 2026: "A report under Reports") */}
        <Link href={CONTRACTS_REPORT_PATH} className="btn btn-secondary">
          Contracts report
        </Link>
      </div>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Contracts searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
