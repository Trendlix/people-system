import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { SetPasswordForm } from './set-password-form';

// The page a set-password link opens (owner, 22 October 2026: "Set-password link"): an invitation to the first password,
// or a reset; open without a session, in a browser or the app (it opens the website). The link's token is after its #.

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Set Your Password · People System', ...(await brandMetadata()), referrer: 'no-referrer' };
}

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">Set Your Password</h1>
          <SetPasswordForm />
        </div>
      </div>
    </main>
  );
}
