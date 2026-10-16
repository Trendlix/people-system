import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../ui';
import { HolidaysSection } from './holidays-section';
import { LawRatesSection } from './law-rates-section';
import { PayingSalariesSection } from './paying-section';
import { YourRulesSection } from './rules-section';
import { holidaysYear, seesPayrollSettings } from './settings';

// Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the variables that might
// affect the sheet"), in place of Organization → Payroll: everything that changes the payroll sheet, in four sections,
// in this order, each loading and saving on its own. 1 Your Rules: the company's rules after its payroll sheet, and the
// defaults new contracts start with. 2 Rates Set by Law: the year's legal rates and tax brackets. 3 Holidays and Working
// Days: the official holidays, which come out of each shift's working days for the expected hours. 4 Paying Salaries:
// the bank files' details and the payday. HR, Finance, the CEO and Admin see it; HR and Admin change it (the API
// checks every request again). Changed rules apply to runs made or refreshed afterwards; approved runs keep what they
// were worked out with (each run copies them).

export const metadata: Metadata = { title: 'Payroll Setup · People System' };

/** Each section waits for its own data only. */
const Section = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<Loading />}>{children}</Suspense>;

function PayrollSetup({ user, year }: { user: SessionUser; year: number }) {
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        Everything that changes how each month&apos;s <Link href="/payroll">payroll</Link> is worked out and paid. A run keeps what it was made or last
        refreshed with, so a change here applies to runs made or refreshed afterwards; approved runs keep theirs.
      </p>
      <Section>
        <YourRulesSection user={user} />
      </Section>
      <Section>
        <LawRatesSection user={user} />
      </Section>
      <Section>
        <HolidaysSection user={user} year={year} />
      </Section>
      <Section>
        <PayingSalariesSection user={user} />
      </Section>
    </div>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/payroll'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!seesPayrollSettings(user)) return <Empty>Only HR, Finance, the CEO and Admin can see the payroll setup.</Empty>;
  const year = holidaysYear((await searchParams).year, todayInCairo());
  return <PayrollSetup user={user} year={year} />;
}

export default function PayrollSetupPage({ searchParams }: PageProps<'/organization/payroll'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
