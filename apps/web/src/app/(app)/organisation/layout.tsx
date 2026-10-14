import { Suspense } from 'react';
import { Tabs, TabsFallback } from './tabs';

export default function OrganisationLayout({ children }: LayoutProps<'/organisation'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Organisation</h1>
      <p className="mt-1 text-muted">Departments, job titles with their job descriptions, and work shifts.</p>
      <nav aria-label="Organisation" className="mt-4 flex gap-6 overflow-x-auto border-b border-line">
        <Suspense fallback={<TabsFallback />}>
          <Tabs />
        </Suspense>
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
