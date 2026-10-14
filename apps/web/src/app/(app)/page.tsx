import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { API_URL } from '@/lib/api';

const MODULES = [
  { title: 'Organization', text: 'Company profile, departments with their teams, job titles and job descriptions, shifts.', href: '/organization/company' },
  { title: 'Employees', text: 'Directory and employee profiles.', href: '/employees' },
  { title: 'Contracts', text: 'Contract versions, durations and expiry alerts.' },
];

async function SystemStatus() {
  await connection();
  let ok = false;
  try {
    ok = (await fetch(`${API_URL}/api/health`)).ok;
  } catch {
    ok = false;
  }
  return ok ? (
    <span className="text-ok">Server and database connected</span>
  ) : (
    <span className="text-danger">Server not reachable</span>
  );
}

export default function HomePage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-1 text-muted">TrendLIX People System. Modules go live one at a time.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) =>
          m.href ? (
            <Link key={m.title} href={m.href} className="card block p-5 text-ink no-underline hover:border-accent">
              <span className="badge">Live</span>
              <h2 className="mt-3 font-semibold">{m.title}</h2>
              <p className="mt-1 text-sm text-muted">{m.text}</p>
            </Link>
          ) : (
            <div key={m.title} className="card p-5 opacity-70">
              <span className="badge bg-line-soft text-muted">Coming next</span>
              <h2 className="mt-3 font-semibold">{m.title}</h2>
              <p className="mt-1 text-sm text-muted">{m.text}</p>
            </div>
          ),
        )}
      </div>

      <p className="mt-8 text-sm">
        <Suspense fallback={<span className="text-muted">Checking server…</span>}>
          <SystemStatus />
        </Suspense>
      </p>
    </div>
  );
}
