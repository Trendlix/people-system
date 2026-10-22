import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { ForgotForm } from './forgot-form';

// Forgot password (owner, 22 October 2026: "Set-password link"): a link to set a new password, emailed to the sign-in
// email typed when an active account has it; the same answer either way. Open without a session.

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Forgot Password · People System', ...(await brandMetadata()) };
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">Forgot Password</h1>
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
