import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { holidaysHref, holidaysYear } from '../holidays/holidays';
import { Empty, Loading } from '../ui';
import { LawRatesSection } from './law-rates-section';
import { PayingSalariesSection } from './paying-section';
import { YourRulesSection } from './rules-section';
import { seesPayrollSettings } from './settings';

// Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the variables that might
// affect the sheet"), in place of Organization → Payroll: what changes the payroll sheet, in sections, in this order,
// each loading and saving on its own. 1 Your Rules: the company's rules after its payroll sheet, and the defaults new
// contracts start with. 2 Rates Set by Law: the year's legal rates and tax brackets. The official holidays, which come
// out of each shift's working days for the expected hours, were the third section until they got a tab of their own
// (owner, 16 October 2026: "make holiday a separate tab"): a line points there in their place, and an old link to them
// (?year=) goes there. 4 Paying Salaries: the bank files' details and the payday. HR, Finance, the CEO and Admin see
// it; HR and Admin change it (the API checks every request again). Changed rules apply to runs made or refreshed
// afterwards; approved runs keep what they were worked out with (each run copies them).

export const metadata: Metadata = { title: 'Payroll Setup · People System' };

/** Each section waits for its own data only. */
const Section = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<Loading />}>{children}</Suspense>;

function PayrollSetup({ user }: { user: SessionUser }) {
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
      <p className="card px-6 py-4 text-sm">
        Holidays: a new run&apos;s expected hours leave out the holidays on the <Link href={holidaysHref()}>Holidays tab</Link>.
      </p>
      <Section>
        <PayingSalariesSection user={user} />
      </Section>
    </div>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/payroll'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!seesPayrollSettings(user)) return <Empty>Only HR, Finance, the CEO and Admin can see the payroll setup.</Empty>;
  // the holidays' year in the address: a link to the section they were, now on their own tab
  const asked = (await searchParams).year;
  if (asked !== undefined) redirect(holidaysHref(holidaysYear(asked, todayInCairo())));
  return <PayrollSetup user={user} />;
}

export default function PayrollSetupPage({ searchParams }: PageProps<'/organization/payroll'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
