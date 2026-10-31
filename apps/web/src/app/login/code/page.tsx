import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { CodeForm } from './code-form';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): a 6-digit code emailed to the sign-in email typed, when an active account
// has it (the same answer either way), traded for a session as a password is. Open without a session.

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Sign In With a Code · People System', ...(await brandMetadata()) };
}

export default function SignInCodePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">Sign In With a Code</h1>
          <Suspense>
            <CodeForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
