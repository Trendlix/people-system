import Link from 'next/link';
import { EMAIL_SETTINGS_PATH } from '@/lib/email-setup';

/**
 * "Set up email" to Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization
 * setup"), shown to a Super Admin after a "not set up" message (setsUpEmail in lib/email-setup.ts).
 */
export function SetUpEmailLink() {
  return (
    <Link href={EMAIL_SETTINGS_PATH} className="font-semibold whitespace-nowrap">
      Set up email
    </Link>
  );
}
