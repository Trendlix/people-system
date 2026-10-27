import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { canSeeSocialInsurance, SOCIAL_INSURANCE_PATH } from './social-insurance';

// The Social Insurance report's link on the Payroll Reports page (owner, 27 October 2026: "is there a report for the social
// insurance? to be filled from the social insurance tab"), beside Payroll vs Social Insurance: for those who may open it
// (HR, Finance and the CEO, as the hub).
export async function SocialInsuranceLink() {
  const user = await getCurrentUser();
  if (!canSeeSocialInsurance(user)) return null;
  return (
    <>
      {' '}
      From each Social Insurance tab, the register, a month&rsquo;s contributions and the missing data: <Link href={SOCIAL_INSURANCE_PATH}>Social Insurance</Link>.
    </>
  );
}
