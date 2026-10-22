'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LABELS, type PublicVacancySummary } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { factsLine, jobHref } from './careers';
import { ArrowUpRight } from './icons';
import { departmentsOf, jobsIn } from './site';

// The open roles as trendlix.com shows its work (owner, 22 October 2026: "i need it to match the UI"; then its new
// design): its tab pills to show one department's roles (only departments with an open role, All first, each with its
// count), then a grid of its dark cards, each with its department, its title, its facts and closing date, and a round
// light button to its page and form. Nothing open: one box saying so.

function Pill({ label, count, pressed, onClick }: { label: string; count: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="careers-pill" aria-pressed={pressed} onClick={onClick}>
      {label}
      <sup aria-hidden="true">{count}</sup>
      <span className="sr-only"> ({count})</span>
    </button>
  );
}

export function JobsBrowser({ jobs }: { jobs: PublicVacancySummary[] }) {
  const [department, setDepartment] = useState<string | null>(null);
  const departments = departmentsOf(jobs);
  const shown = jobsIn(jobs, department);

  if (jobs.length === 0) {
    return (
      <div className="careers-box px-6 py-12 text-center sm:px-10">
        <p className="careers-display text-[clamp(32px,5vw,48px)] leading-none">No roles are open right now.</p>
        <p className="mt-4 text-white/[0.64]">Please check again soon, or send us your CV below.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {departments.length > 1 && (
        <div role="group" aria-label="Show the roles of" className="flex flex-wrap gap-3">
          <Pill label="All" count={jobs.length} pressed={department === null} onClick={() => setDepartment(null)} />
          {departments.map((d) => (
            <Pill key={d} label={d} count={jobsIn(jobs, d).length} pressed={department === d} onClick={() => setDepartment(d)} />
          ))}
        </div>
      )}
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" aria-live="polite">
        {shown.map((v) => (
          <li key={v.slug}>
            <Link href={jobHref(v.slug)} className="careers-card">
              {v.department && <span className="text-[15px] leading-7 text-white/[0.64]">{v.department}</span>}
              <span className="careers-card-title">{v.title}</span>
              <span className="mt-auto block space-y-6 border-t border-white/[0.08] pt-6">
                <span className="block text-base leading-[26px] text-white/[0.64]">
                  {factsLine([LABELS.employmentType[v.employmentType], LABELS.workArrangement[v.workArrangement]])}
                  <br />
                  {v.closingDate ? `Apply by ${formatDate(v.closingDate)}` : 'Open until filled'}
                </span>
                <span className="careers-btn-round">
                  View role
                  <ArrowUpRight className="careers-arrow-out size-4" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
