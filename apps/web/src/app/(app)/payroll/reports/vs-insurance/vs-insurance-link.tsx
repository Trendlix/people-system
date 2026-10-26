import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { canSeeVsInsurance, VS_INSURANCE_PATH } from './vs-insurance';

// The Payroll vs Social Insurance report's link on the Payroll Reports page (owner, 26 October 2026: "i want a comparison
// report between the actual payroll run and the social insurance data"), beside the Salary Raises, Contracts and Leave
// links: for those who may open it (HR, Finance and the CEO, as the hub).
export async function VsInsuranceLink() {
  const user = await getCurrentUser();
  if (!canSeeVsInsurance(user)) return null;
  return (
    <>
      {' '}
      The actual payroll beside the social insurance cycle: <Link href={VS_INSURANCE_PATH}>Payroll vs Social Insurance</Link>.
    </>
  );
}
