import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { LoginForm } from './login-form';

/** The browser tab icon: the company's thumbnail when there is one. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Sign In · People System', ...(await brandMetadata()) };
}

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
          <h1 className="mb-6 text-xl font-semibold">Sign In</h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
