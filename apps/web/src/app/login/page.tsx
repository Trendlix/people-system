import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { FingerprintSignIn } from './fingerprint-sign-in';
import { LoginForm } from './login-form';
import { SignedOutNotice } from './signed-out-notice';

/** The browser tab icon: the company's thumbnail when there is one. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Sign In · People System', ...(await brandMetadata()) };
}

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">Sign In</h1>
          {/* why they were signed out, when they were (20 October 2026: sessions kept on the server) */}
          <Suspense fallback={null}>
            <SignedOutNotice searchParams={searchParams} />
          </Suspense>
          {/* in the app, with a sign-in kept behind the phone's fingerprint: Sign in with fingerprint above the password
              (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app); nothing elsewhere */}
          <Suspense>
            <FingerprintSignIn />
            <LoginForm />
          </Suspense>
          {/* a reset link by email (owner, 22 October 2026: "Set-password link"), or a code to sign in with (31 October 2026:
              "and i can add OTP via Mail for app login", "via app and web") */}
          <p className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-center text-sm">
            <Link href="/forgot-password">Forgot password?</Link>
            <Link href="/login/code">Email me a sign-in code</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
