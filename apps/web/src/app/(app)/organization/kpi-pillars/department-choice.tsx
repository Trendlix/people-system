'use client';

import type { KpiFrameworkView } from '@trendlix/shared';
import { useId, useState } from 'react';
import type { FormState } from '@/lib/types';
import { canFollowCompany, hasOwnPillars } from '../../kpis/templates/framework';
import { FollowCompanyForm, KpiFrameworkForm, type PillarsDepartment } from '../../kpis/templates/framework-form';

// A department's pillars as HR (or the Super Admin) changes them (owner, 22 October 2026: "but i need pillars to each
// department"): its own pillars, or the company's. Its own: the pillar form, starting from its own (or a copy of the
// company's); the company's: going back to them from a month, when it has its own now or a change coming (otherwise
// there is nothing to change). A team's the same way ("Yes, add team pillars"), with its department's in place of the
// company's.

export function DepartmentPillarsChoice({
  view,
  department,
  action,
  today,
}: {
  view: KpiFrameworkView;
  department: PillarsDepartment;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  today: string;
}) {
  const id = useId();
  const [choice, setChoice] = useState<'own' | 'company'>(() => (hasOwnPillars(department.row) ? 'own' : 'company'));
  // a team's department ("The department’s pillars (Production)"), else the company
  const parent = department.row.parent;
  const aboveLabel = parent ? `The department’s pillars (${parent.nameEn})` : 'The company’s pillars';
  const above = department.above?.possessive ?? 'the company’s';
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">{department.name} takes</legend>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              ['own', 'Its own pillars'],
              ['company', aboveLabel],
            ] as const
          ).map(([value, label]) => (
            <label key={value} htmlFor={`${id}-${value}`} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input
                id={`${id}-${value}`}
                type="radio"
                name={`${id}-choice`}
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                className="size-4 accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {choice === 'own' ? (
        <KpiFrameworkForm view={view} action={action} today={today} department={department} />
      ) : canFollowCompany(department.row) ? (
        <FollowCompanyForm view={view} department={department} action={action} today={today} />
      ) : (
        <p className="text-sm text-muted">
          {department.name} takes {above} pillars, with nothing coming: there is nothing to change. Choose “Its own pillars” to set pillars for it alone.
        </p>
      )}
    </div>
  );
}
