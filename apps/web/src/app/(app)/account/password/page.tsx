import type { Metadata } from 'next';
import { ChangePasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Change Password · People System' };

export default function ChangePasswordPage() {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="page-title">Change Password</h1>
      <ChangePasswordForm />
    </div>
  );
}
