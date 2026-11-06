import type { EmployeeProfile } from '@/lib/types';
import { setTestAccount } from '../actions';
import { TEST_ACCOUNT_TEXT, testAccountConfirm } from '../test-account';
import { ActionButton } from './contracts/contract-buttons';

/**
 * The Test Account switch on Basic Data (owner, 6 November 2026: an account for Google's and Apple's app reviewers
 * "without real data", then "Yes, build it"). HR and Super Admins only, never on their own profile (the page decides;
 * the API checks too). Making it a test account asks first; making it real again doesn't.
 */
export function TestAccountSection({ profile: p }: { profile: EmployeeProfile }) {
  const test = p.testAccount === true;
  return (
    <section className="card space-y-3 p-6">
      <h2 className="font-semibold">Test Account</h2>
      <p className="text-sm text-muted">{TEST_ACCOUNT_TEXT}</p>
      {test ? (
        <ActionButton action={setTestAccount.bind(null, p.id, false)} pendingText="Saving…">
          Make it a real profile again
        </ActionButton>
      ) : (
        <ActionButton action={setTestAccount.bind(null, p.id, true)} pendingText="Saving…" confirmText={testAccountConfirm(p.fullNameEn)}>
          Make it a test account
        </ActionButton>
      )}
    </section>
  );
}
