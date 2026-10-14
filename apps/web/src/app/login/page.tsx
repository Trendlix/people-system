import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback } from '@/components/brand';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · People System' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
