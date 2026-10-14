import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · People System' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sidebar text-lg font-bold text-white">T</span>
          <div>
            <p className="font-semibold leading-tight">TrendLIX</p>
            <p className="text-sm text-muted">People System</p>
          </div>
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
