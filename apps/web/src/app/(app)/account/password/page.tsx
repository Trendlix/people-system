import type { Metadata } from 'next';
import { ChangePasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Change Password · People System' };

export default function ChangePasswordPage() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Change Password</h1>
        <p className="mt-1 text-muted">If an admin gave you a temporary password, replace it here with one only you know.</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
